import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '@/App';
import { ExperimentFormDialog } from '@/features/forms';
import { api, type UploadedImage } from '@/services/api';
import { installFakeApi, makeProject } from './fakeApi';

function deferred() {
  let resolve!: (v: UploadedImage) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<UploadedImage>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const file = () => new File(['png'], 'plot.png', { type: 'image/png' });
const uploaded = (letter = 'a'): UploadedImage => ({ url: `/api/v1/uploads/${letter.repeat(32)}.png`, name: `${letter.repeat(32)}.png`, size: 3, content_type: 'image/png' });
function Harness() {
  const [open, setOpen] = useState(true);
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <button onClick={() => setOpen(true)}>Reopen</button>
    <ExperimentFormDialog open={open} onOpenChange={setOpen} projectId={1} />
  </QueryClientProvider>;
}
beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('blocks both button and form submission until all Markdown fields finish uploading', async () => {
  const state = installFakeApi({ projects: [makeProject({ id: 1 })] });
  const first = deferred(), second = deferred();
  vi.spyOn(api, 'uploadImage').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  render(<Harness />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Name/), 'Upload experiment');
  const inputs = screen.getAllByTestId('image-file-input');
  await user.upload(inputs[0], file());
  await user.upload(inputs[1], file());
  const submit = document.querySelector('button[type="submit"]')!;
  expect(submit).toBeDisabled();
  fireEvent.submit(document.querySelector('form')!);
  expect(state.experiments).toHaveLength(0);
  await act(async () => first.resolve(uploaded('a')));
  expect(submit).toBeDisabled();
  await act(async () => second.resolve(uploaded('b')));
  expect(submit).toBeEnabled();
  await user.click(submit);
  await waitFor(() => expect(state.experiments).toHaveLength(1));
  expect(state.experiments[0].description).toContain(uploaded('a').url);
  expect(state.experiments[0].conclusion).toContain(uploaded('b').url);
});

it('recovers from upload failure and can retry without saving stale content', async () => {
  const state = installFakeApi({ projects: [makeProject({ id: 1 })] });
  const first = deferred();
  vi.spyOn(api, 'uploadImage').mockReturnValueOnce(first.promise).mockResolvedValueOnce(uploaded());
  render(<Harness />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Name/), 'Retry experiment');
  const input = screen.getAllByTestId('image-file-input')[0];
  await user.upload(input, file());
  expect(document.querySelector('button[type="submit"]')).toBeDisabled();
  await act(async () => first.reject(new Error('offline')));
  expect(document.querySelector('button[type="submit"]')).toBeEnabled();
  expect(state.experiments).toHaveLength(0);
  await user.upload(input, file());
  await waitFor(() => expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toContain(uploaded().url));
  await user.click(document.querySelector('button[type="submit"]')!);
  await waitFor(() => expect(state.experiments[0]?.description).toContain(uploaded().url));
});

it('does not insert a canceled upload into a newly reopened form', async () => {
  installFakeApi({ projects: [makeProject({ id: 1 })] });
  const pending = deferred();
  vi.spyOn(api, 'uploadImage').mockReturnValue(pending.promise);
  render(<Harness />);
  const user = userEvent.setup();
  await user.upload(screen.getAllByTestId('image-file-input')[0], file());
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(screen.getByRole('button', { name: 'Reopen' }));
  await act(async () => pending.resolve(uploaded()));
  expect(screen.getByLabelText('Description')).toHaveValue('');
  expect(document.querySelector('button[type="submit"]')).toBeEnabled();
});

it('waits for images before saving project notes', async () => {
  const state = installFakeApi({ projects: [makeProject({ id: 1, slug: 'notes', title: 'Notes project' })] });
  const pending = deferred();
  vi.spyOn(api, 'uploadImage').mockReturnValue(pending.promise);
  render(<App initialPath='/projects/notes?tab=notes' />);
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole('button', { name: /^Edit$/ })).at(-1)!);
  await user.upload(screen.getByTestId('image-file-input'), file());
  const submit = screen.getByRole('button', { name: /^Save$/ });
  expect(submit).toBeDisabled();
  await user.click(submit);
  expect(state.projects[0].notes).toBe('');
  await act(async () => pending.resolve(uploaded()));
  await user.click(submit);
  await waitFor(() => expect(state.projects[0].notes).toContain(uploaded().url));
});
