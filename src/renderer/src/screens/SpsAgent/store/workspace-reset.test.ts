import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./index";

describe("workspace reset safety", () => {
  beforeEach(() => {
    localStorage.setItem("sps-agent-storage-mode-v1", "blob");
    useStore.setState({
      tree: [
        { id: "home", children: [] },
        { id: "valuable", children: [] },
      ],
      meta: {
        home: { icon: "🏠", title: "Home", cover: null },
        valuable: { icon: "📄", title: "Valuable", cover: null },
      },
      docs: {
        home: [{ id: "home-1", type: "p", text: "Home" }],
        valuable: [{ id: "valuable-1", type: "p", text: "Keep me" }],
      },
      comments: [],
      trash: [],
      page: "valuable",
    });
  });

  it("does not mutate the workspace until the safety backup finishes", async () => {
    let finishBackup:
      | ((value: {
          id: string;
          createdAt: number;
          bytes: number;
          fileCount: number;
        }) => void)
      | undefined;
    const backup = new Promise<{
      id: string;
      createdAt: number;
      bytes: number;
      fileCount: number;
    }>((resolve) => {
      finishBackup = resolve;
    });
    const spsSave = vi.fn().mockResolvedValue({
      ok: true,
      rev: 1,
      merged: false,
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsCreateBackup: vi.fn().mockReturnValue(backup),
        spsSave,
      },
    });

    const reset = useStore.getState().resetWorkspace();
    await vi.waitFor(() =>
      expect(window.hermesAPI.spsCreateBackup).toHaveBeenCalledOnce(),
    );
    expect(spsSave).toHaveBeenCalledOnce();
    expect(useStore.getState().docs.valuable?.[0]?.text).toBe("Keep me");
    expect(spsSave).not.toHaveBeenCalledWith(null);

    finishBackup?.({ id: "1", createdAt: 1, bytes: 10, fileCount: 2 });
    await reset;

    expect(spsSave).toHaveBeenCalledTimes(2);
    expect(useStore.getState().docs.valuable).toBeUndefined();
    expect(useStore.getState().page).toBe("home");
    expect(spsSave.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ page: "valuable" }),
    );
    expect(spsSave.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        page: "home",
        docs: { home: expect.any(Array) },
      }),
    );
  });

  it("refuses the destructive reset when the backup fails", async () => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsCreateBackup: vi.fn().mockResolvedValue(null),
        spsSave: vi.fn().mockResolvedValue({
          ok: true,
          rev: 1,
          merged: false,
        }),
      },
    });

    await useStore.getState().resetWorkspace();

    expect(useStore.getState().docs.valuable?.[0]?.text).toBe("Keep me");
    expect(useStore.getState().toast?.text).toMatch(/Reset refused/);
  });

  it("keeps the current workspace when the blank workspace cannot be saved", async () => {
    const spsSave = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, rev: 1, merged: false })
      .mockResolvedValueOnce({
        ok: false,
        error: "disk full",
        rev: 1,
        merged: false,
      });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsCreateBackup: vi.fn().mockResolvedValue({
          id: "1",
          createdAt: 1,
          bytes: 10,
          fileCount: 2,
        }),
        spsSave,
      },
    });

    await useStore.getState().resetWorkspace();

    expect(spsSave).toHaveBeenCalledTimes(2);
    expect(useStore.getState().docs.valuable?.[0]?.text).toBe("Keep me");
    expect(useStore.getState().toast?.text).toMatch(/Reset refused/);
  });

  it("persists the blank vault manifest before deleting replaced page files", async () => {
    localStorage.setItem("sps-agent-storage-mode-v1", "vault");
    const writeSnapshot = vi.fn().mockResolvedValue(true);
    const deletePage = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        spsCreateBackup: vi.fn().mockResolvedValue({
          id: "1",
          createdAt: 1,
          bytes: 10,
          fileCount: 2,
        }),
        spsVaultWriteSnapshot: writeSnapshot,
        spsDeletePage: deletePage,
      },
    });

    await useStore.getState().resetWorkspace();

    expect(writeSnapshot).toHaveBeenCalledTimes(2);
    const freshSnapshot = writeSnapshot.mock.calls[1]?.[0] as {
      pages: Record<string, string>;
      manifest: string;
    };
    expect(Object.keys(freshSnapshot.pages)).toEqual(["home"]);
    expect(JSON.parse(freshSnapshot.manifest).tree).toEqual([
      { id: "home", children: [] },
    ]);
    expect(deletePage).toHaveBeenCalledWith("valuable");
    expect(
      writeSnapshot.mock.invocationCallOrder[1],
    ).toBeLessThan(deletePage.mock.invocationCallOrder[0]);
  });
});
