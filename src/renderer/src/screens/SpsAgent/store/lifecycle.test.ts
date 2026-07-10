import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
}));

vi.mock("../lib/persistence", () => ({
  loadWorkspace: mocks.loadWorkspace,
  saveWorkspace: vi.fn(),
  mirrorPage: vi.fn(),
  mirrorAllPages: vi.fn(),
}));
vi.mock("../lib/storageMode", () => ({ getStorageMode: () => "blob" }));
vi.mock("../lib/vaultStore", () => ({
  readVaultWorkspace: vi.fn(),
  saveVaultPage: vi.fn(),
  deleteVaultPages: vi.fn(),
}));
vi.mock("../lib/assets", () => ({ gcOrphanAssets: vi.fn() }));

import { hydrateWorkspace } from "./lifecycle";

describe("SPS store lifecycle", () => {
  it("shares one in-flight hydration across concurrent mounts", async () => {
    let finishLoad: ((value: null) => void) | undefined;
    mocks.loadWorkspace.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        finishLoad = resolve;
      }),
    );

    const first = hydrateWorkspace();
    const second = hydrateWorkspace();

    expect(second).toBe(first);
    expect(mocks.loadWorkspace).toHaveBeenCalledTimes(1);

    finishLoad?.(null);
    await expect(first).resolves.toBeUndefined();
  });
});
