import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "../types";

const mocks = vi.hoisted(() => ({
  readVaultWorkspace: vi.fn(),
  saveVaultPages: vi.fn(),
  loadWorkspace: vi.fn(),
  mirrorAllPages: vi.fn(),
}));

vi.mock("../lib/persistence", () => ({
  loadWorkspace: mocks.loadWorkspace,
  saveWorkspace: vi.fn(),
  mirrorPage: vi.fn(),
  mirrorAllPages: mocks.mirrorAllPages,
}));
vi.mock("../lib/storageMode", () => ({ getStorageMode: () => "vault" }));
vi.mock("../lib/vaultStore", () => ({
  readVaultWorkspace: mocks.readVaultWorkspace,
  saveVaultPages: mocks.saveVaultPages,
  deleteVaultPages: vi.fn(),
}));
vi.mock("../lib/assets", () => ({ gcOrphanAssets: vi.fn() }));

import {
  hydrateWorkspace,
  retryWorkspaceHydration,
  startSpsStoreLifecycle,
} from "./lifecycle";
import { useStore } from "./index";

const workspace: Workspace = {
  tree: [{ id: "home", children: [{ id: "background", children: [] }] }],
  meta: {
    home: { title: "Home", icon: "🏠", cover: null },
    background: { title: "Background", icon: "📄", cover: null },
  },
  docs: {
    home: [{ id: "home-p", type: "p", text: "Home" }],
    background: [{ id: "background-p", type: "p", text: "Before" }],
  },
  comments: [],
  trash: [],
  page: "home",
};

describe("SPS vault lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.readVaultWorkspace.mockResolvedValue(workspace);
    mocks.saveVaultPages.mockResolvedValue({
      ok: true,
      rev: 0,
      merged: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("persists a changed background page without selecting it", async () => {
    await hydrateWorkspace();
    const stop = startSpsStoreLifecycle();

    useStore.setState((state) => ({
      docs: {
        ...state.docs,
        background: [{ id: "background-p", type: "p", text: "After" }],
      },
    }));
    await vi.advanceTimersByTimeAsync(351);

    expect(useStore.getState().page).toBe("home");
    expect(mocks.saveVaultPages).toHaveBeenCalledTimes(1);
    expect(mocks.saveVaultPages.mock.calls[0][1]).toEqual(["background"]);

    stop();
  });

  it("does not fall back to and mirror the blob after a vault read error", async () => {
    mocks.readVaultWorkspace.mockRejectedValueOnce(
      new Error("transient vault read failure"),
    );

    await retryWorkspaceHydration();

    expect(mocks.loadWorkspace).not.toHaveBeenCalled();
    expect(mocks.mirrorAllPages).not.toHaveBeenCalled();
    expect(useStore.getState().workspaceLoadIssue).toEqual({
      kind: "error",
      error: "transient vault read failure",
    });
  });
});
