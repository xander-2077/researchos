import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { RunFormDialog } from '@/features/forms';
import { api } from '@/services/api';
import type { Run } from '@/types/api';

const run = {
  id: 1, external_run_id: 'run-1', experiment_id: 1, config_json: {}, metrics_json: { old: { value: 0.5, unit: '', description: '' } },
  artifact_links: [], status: 'completed', verification_status: 'needs_review', conclusion: '',
} as unknown as Run;
function setup() {
  const update = vi.spyOn(api, 'updateRun').mockResolvedValue(run);
  render(<QueryClientProvider client={new QueryClient()}><RunFormDialog open onOpenChange={() => {}} experimentId={1} run={run} /></QueryClientProvider>);
  return { update, user: userEvent.setup() };
}
afterEach(() => vi.restoreAllMocks());
it('saves deletion of the last metric as an explicit empty replacement', async () => {
  const { user, update } = setup();
  await user.click(screen.getByRole('button', { name: 'Remove metric' }));
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ metrics: {}, metrics_mode: 'replace' })));
});
it('renames a metric without retaining the previous key', async () => {
  const { user, update } = setup();
  await user.clear(screen.getByLabelText('Metric 1 name'));
  await user.type(screen.getByLabelText('Metric 1 name'), 'renamed');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(update).toHaveBeenCalledWith(1, expect.objectContaining({ metrics: { renamed: { value: 0.5, unit: '', description: '' } }, metrics_mode: 'replace' })));
});
it.each(['NaN', 'Infinity', '-Infinity', '1e999'])('rejects non-finite metric %s before submission', async (value) => {
  const { user, update } = setup();
  await user.clear(screen.getByLabelText('Metric 1 value'));
  await user.type(screen.getByLabelText('Metric 1 value'), value);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Each metric needs a name and a numeric value');
  expect(update).not.toHaveBeenCalled();
});
