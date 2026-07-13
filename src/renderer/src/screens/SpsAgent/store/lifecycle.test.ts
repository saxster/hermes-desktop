import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
}));

vi.mock("../lib/persistence", () => ({
  loadWorkspace: mocks.loadWorkspace,
  saveWorkspace: mocks.saveWorkspace,
  mirrorPage: vi.fn(),
  mirrorAllPages: vi.fn(),
}));
vi.mock("../lib/storageMode", () => ({ getStorageMode: () => "blob" }));
vi.mock("../lib/vaultStore", () => ({
  readVaultWorkspace: vi.fn(),
  saveVaultPages: vi.fn(),
  deleteVaultPages: vi.fn(),
}));
vi.mock("../lib/assets", () => ({ gcOrphanAssets: vi.fn() }));

import {
  hydrateWorkspace,
  retryWorkspaceHydration,
  startSpsStoreLifecycle,
} from "./lifecycle";
import { useStore } from "./index";

describe("SPS store lifecycle", () => {
  it("shares one in-flight hydration across concurrent mounts", async () => {
    let finishLoad: ((value: { status: "missing" }) => void) | undefined;
    mocks.loadWorkspace.mockReturnValueOnce(
      new Promise<{ status: "missing" }>((resolve) => {
        finishLoad = resolve;
      }),
    );

    const first = hydrateWorkspace();
    const second = hydrateWorkspace();

    expect(second).toBe(first);
    expect(mocks.loadWorkspace).toHaveBeenCalledTimes(1);

    finishLoad?.({ status: "missing" });
    await expect(first).resolves.toBeUndefined();
  });

  it("blocks autosave when the authoritative workspace is corrupt", async () => {
    vi.useFakeTimers();
    mocks.loadWorkspace.mockResolvedValueOnce({
      status: "corrupt",
      error: "Unexpected token",
    });
    await retryWorkspaceHydration();
    const stop = startSpsStoreLifecycle();

    useStore.setState((state) => ({
      docs: { ...state.docs, home: [] },
    }));
    await vi.advanceTimersByTimeAsync(351);

    expect(mocks.saveWorkspace).not.toHaveBeenCalled();
    expect(useStore.getState().workspaceLoadIssue).toEqual({
      kind: "corrupt",
      error: "Unexpected token",
    });
    stop();
    vi.useRealTimers();
  });
});
