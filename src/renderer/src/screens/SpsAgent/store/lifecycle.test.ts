import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
  mirrorAllPages: vi.fn(),
}));

vi.mock("../lib/persistence", () => ({
  loadWorkspace: mocks.loadWorkspace,
  saveWorkspace: mocks.saveWorkspace,
  mirrorPage: vi.fn(),
  mirrorAllPages: mocks.mirrorAllPages,
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
  flushSpsStorePersistence,
  startSpsStoreLifecycle,
} from "./lifecycle";
import { useStore } from "./index";

describe("SPS store lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ saveError: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("reloads the authoritative workspace after a stale-base merge", async () => {
    vi.useFakeTimers();
    const initial = {
      tree: [{ id: "home", children: [] }],
      meta: { home: { title: "Home", icon: "🏠", cover: null } },
      docs: { home: [{ id: "p1", type: "p", text: "Initial" }] },
      comments: [],
      trash: [],
      page: "home",
    };
    const merged = {
      ...initial,
      tree: [
        { id: "home", children: [] },
        { id: "concurrent", children: [] },
      ],
      meta: {
        ...initial.meta,
        concurrent: { title: "Concurrent", icon: "📄", cover: null },
      },
      docs: {
        home: [{ id: "p1", type: "p", text: "Local edit" }],
        concurrent: [{ id: "p2", type: "p", text: "Remote edit" }],
      },
    };
    mocks.loadWorkspace
      .mockResolvedValueOnce({ status: "ok", workspace: initial })
      .mockResolvedValueOnce({ status: "ok", workspace: merged });
    mocks.saveWorkspace.mockResolvedValueOnce({
      ok: true,
      rev: 2,
      merged: true,
    });

    await retryWorkspaceHydration();
    const stop = startSpsStoreLifecycle();
    useStore.setState({
      docs: {
        home: [{ id: "p1", type: "p", text: "Local edit" }],
      },
    });
    await vi.advanceTimersByTimeAsync(351);
    await Promise.resolve();

    expect(mocks.loadWorkspace).toHaveBeenCalledTimes(2);
    expect(useStore.getState().docs.concurrent).toEqual(merged.docs.concurrent);
    expect(mocks.mirrorAllPages).toHaveBeenLastCalledWith(
      expect.objectContaining({ docs: merged.docs }),
    );

    stop();
    vi.useRealTimers();
  });

  it("dispatches a later stale-base save before an earlier save settles", async () => {
    vi.useFakeTimers();
    mocks.loadWorkspace
      .mockResolvedValueOnce({ status: "missing" })
      .mockResolvedValueOnce({ status: "missing" });
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    mocks.saveWorkspace
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishFirst = () => resolve({ ok: true, rev: 1, merged: false });
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finishSecond = () => resolve({ ok: true, rev: 2, merged: true });
        }),
      );

    await retryWorkspaceHydration();
    const stop = startSpsStoreLifecycle();
    useStore.setState((state) => ({
      docs: {
        ...state.docs,
        home: [{ id: "p1", type: "p", text: "First edit" }],
      },
    }));
    await vi.advanceTimersByTimeAsync(351);
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);

    useStore.setState((state) => ({
      docs: {
        ...state.docs,
        home: [{ id: "p1", type: "p", text: "Second edit" }],
      },
    }));
    await vi.advanceTimersByTimeAsync(351);

    // saveWorkspace captures baseRev at invocation. Dispatching the second call
    // now lets the main-process queue recognize it as stale and merge it; a
    // renderer-side queue would invoke it only after the first updates baseRev.
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(2);

    finishFirst?.();
    finishSecond?.();
    await vi.waitFor(() =>
      expect(mocks.loadWorkspace).toHaveBeenCalledTimes(2),
    );
    stop();
  });

  it("flushes and awaits the debounced authoritative save", async () => {
    mocks.loadWorkspace.mockResolvedValueOnce({ status: "missing" });
    let finishSave: (() => void) | undefined;
    mocks.saveWorkspace.mockReturnValueOnce(
      new Promise((resolve) => {
        finishSave = () =>
          resolve({
            ok: true,
            rev: 1,
            merged: false,
          });
      }),
    );

    await retryWorkspaceHydration();
    const stop = startSpsStoreLifecycle();
    useStore.setState((state) => ({ docs: { ...state.docs } }));

    let flushed = false;
    const flush = flushSpsStorePersistence().then(() => {
      flushed = true;
    });
    await vi.waitFor(() =>
      expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1),
    );
    expect(flushed).toBe(false);

    finishSave?.();
    await flush;
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mocks.saveWorkspace).toHaveBeenCalledTimes(1);

    stop();
  });

  it("rejects a flush when the authoritative save fails", async () => {
    mocks.loadWorkspace.mockResolvedValueOnce({ status: "missing" });
    mocks.saveWorkspace.mockResolvedValueOnce({
      ok: false,
      error: "disk full",
      rev: 0,
      merged: false,
    });

    await retryWorkspaceHydration();
    const stop = startSpsStoreLifecycle();
    useStore.setState((state) => ({ docs: { ...state.docs } }));

    await expect(flushSpsStorePersistence()).rejects.toThrow("disk full");

    stop();
  });
});
