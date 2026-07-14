import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  hydrateWorkspace: vi.fn().mockResolvedValue(undefined),
  startSpsStoreLifecycle: vi.fn(() => vi.fn()),
}));
const storageMode = vi.hoisted(() => ({ setStorageModeProfile: vi.fn() }));
const store = vi.hoisted(() => ({
  workspaceLoadIssue: null as null,
  t: {},
  ocrResume: vi.fn(),
  ocrStopScheduler: vi.fn(),
}));

vi.mock("./App", () => ({ App: () => <main>Workspace</main> }));
vi.mock("./store/lifecycle", () => lifecycle);
vi.mock("./lib/storageMode", () => storageMode);
vi.mock("./store", () => {
  const useStore = Object.assign(
    (selector: (state: typeof store) => unknown) => selector(store),
    { getState: () => store },
  );
  return { useStore };
});
vi.mock("./lib/theme", () => ({
  setThemeScope: vi.fn(),
  applyTweaks: vi.fn(),
  setSkinVars: vi.fn(),
}));
vi.mock("./lib/skin", () => ({ skinToSpsVars: vi.fn(() => ({})) }));
vi.mock("../../utils/skin", () => ({ getActiveSkinId: vi.fn(() => null) }));
vi.mock("./components/SystemThemeSync", () => ({
  SystemThemeSync: () => null,
}));
vi.mock("./components/WorkspaceRecovery", () => ({
  WorkspaceRecovery: () => null,
}));

import { SpsAgent } from "./SpsAgent";

beforeEach(() => {
  vi.clearAllMocks();
  (window as unknown as { hermesAPI: unknown }).hermesAPI = {
    listProfiles: vi.fn().mockResolvedValue([
      { name: "default", isActive: false },
      { name: "work", isActive: true },
    ]),
    listSkins: vi.fn().mockResolvedValue([]),
  };
});

afterEach(() => {
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
});

describe("SpsAgent profile-scoped storage", () => {
  it("selects the active profile before hydrating its authoritative store", async () => {
    render(<SpsAgent />);

    await waitFor(() =>
      expect(lifecycle.hydrateWorkspace).toHaveBeenCalledTimes(1),
    );
    expect(storageMode.setStorageModeProfile).toHaveBeenCalledWith("work");
    expect(
      storageMode.setStorageModeProfile.mock.invocationCallOrder[0],
    ).toBeLessThan(lifecycle.hydrateWorkspace.mock.invocationCallOrder[0] ?? 0);
  });

  it("hydrates with the default profile when profile discovery is unavailable", async () => {
    vi.mocked(window.hermesAPI.listProfiles).mockRejectedValueOnce(
      new Error("profile service unavailable"),
    );

    render(<SpsAgent />);

    await waitFor(() =>
      expect(lifecycle.hydrateWorkspace).toHaveBeenCalledTimes(1),
    );
    expect(storageMode.setStorageModeProfile).toHaveBeenCalledWith("default");
  });
});
