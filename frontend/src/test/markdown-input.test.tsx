import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownInput } from "@/features/markdown-input";
import { Markdown } from "@/features/common";
import { installFakeApi } from "./fakeApi";

afterEach(() => vi.unstubAllGlobals());

function Harness({ initial = "" }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return <MarkdownInput aria-label="Notes" value={v} onChange={setV} />;
}

describe("image upload in Markdown fields", () => {
  it("uploads a chosen image and inserts it as Markdown on its own line", async () => {
    const state = installFakeApi();
    render(<Harness initial="Result:" />);
    const user = userEvent.setup();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "loss-curve.png", { type: "image/png" });
    await user.upload(screen.getByTestId("image-file-input"), file);
    const box = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe(`Result:\n![loss-curve](/api/v1/uploads/${"a".repeat(32)}.png)\n`));
    const call = state.calls.find((c) => c.path === "/uploads");
    expect(call?.method).toBe("POST");
    expect(call?.headers["Content-Type"]).toBe("image/png");
  });

  it("uploads pasted screenshots", async () => {
    installFakeApi();
    render(<Harness />);
    const user = userEvent.setup();
    const box = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    await user.click(box);
    const file = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    await user.paste({ files: [file], items: [], types: ["Files"], getData: () => "" } as unknown as DataTransfer);
    await waitFor(() => expect(box.value).toContain(`![image](/api/v1/uploads/${"a".repeat(32)}.png)`));
  });

  it("renders images and keeps single line breaks", () => {
    const { container } = render(<Markdown breaks>{"line one\nline two\n\n![plot](/api/v1/uploads/x.png)"}</Markdown>);
    expect(container.querySelectorAll("br")).toHaveLength(1);
    const img = screen.getByAltText("plot");
    expect(img).toHaveAttribute("src", "/api/v1/uploads/x.png");
    expect(img.closest("a")).toHaveAttribute("target", "_blank");
  });
});
