import { describe, expect, it } from "vitest";
import { slugify } from "@/pages/Help";

describe("slugify (GitHub-compatible anchors)", () => {
  it("matches GitHub heading ids used in doc links", () => {
    expect(slugify("5. Backup & restore")).toBe("5-backup--restore");
    expect(slugify("Option A — Tailscale Serve (Docker sidecar)")).toBe("option-a--tailscale-serve-docker-sidecar");
    expect(slugify("5. 远程访问（Tailscale）")).toBe("5-远程访问tailscale");
  });
});
