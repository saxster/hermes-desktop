import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  setPaletteOpen: vi.fn(),
  selectPage: vi.fn(),
  tree: [{ id: "page-1", children: [] }],
  meta: {
    "page-1": {
      title: "Launch Notes",
      icon: "📝",
    },
  },
  docs: {
    "page-1": [{ id: "block-1", type: "p", text: "Existing page text" }],
  },
  page: "page-1",
  comments: {},
  trash: [],
  openPanelTab: vi.fn(),
  setTweak: vi.fn(),
  t: { dark: false, sidebar: "full" },
  setTemplatesOpen: vi.fn(),
  setTrashOpen: vi.fn(),
  resetWorkspace: vi.fn(),
  startNewChat: vi.fn(),
  setResearchOpen: vi.fn(),
  setExternalSessionsOpen: vi.fn(),
  setSurface: vi.fn(),
  openInboxImageCapture: vi.fn(),
  flash: vi.fn(),
  openContentStudioIdea: vi.fn(),
  runAgent: vi.fn(),
  setTweaksOpen: vi.fn(),
}));
const theme = vi.hoisted(() => ({ setTheme: vi.fn() }));

vi.mock("../store", () => {
  const useStore = Object.assign(
    (selector: (s: typeof store) => unknown) => selector(store),
    { getState: () => store },
  );
  return { useStore };
});

vi.mock("../../../components/ThemeProvider", () => ({
  useTheme: () => ({
    theme: "system",
    resolved: "light",
    setTheme: theme.setTheme,
  }),
}));

import { CommandPalette } from "./CommandPalette";

const api = {
  getAppVersion: vi.fn(),
  getHermesUpstreamWatchState: vi.fn(),
  spsExportRow: vi.fn(),
};

function installApi(): void {
  (window as unknown as { hermesAPI: unknown }).hermesAPI = api;
  (window as unknown as { electron: unknown }).electron = {
    process: { platform: "darwin" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("hermes-desktop-last-seen-version", "0.5.3");
  installApi();
  api.getAppVersion.mockResolvedValue("0.5.4");
  api.getHermesUpstreamWatchState.mockResolvedValue({
    lastRunAt: null,
    lastSeenCommit: null,
    lastSeenRelease: null,
    latestReportPath: null,
    classifiedCounts: {},
  });
  api.spsExportRow.mockResolvedValue(true);
  vi.spyOn(window, "getSelection").mockReturnValue({
    toString: () => "Selected proof that should become a draft angle.",
  } as Selection);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  delete (window as unknown as { electron?: unknown }).electron;
});

describe("CommandPalette", () => {
  it("describes reset as a destructive blank-workspace action", async () => {
    render(<CommandPalette />);

    expect(
      await screen.findByText("Reset to a blank workspace"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Reset workspace to sample")).toBeNull();
  });

  it("requires confirmation before resetting the workspace", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<CommandPalette />);

    fireEvent.mouseDown(await screen.findByText("Reset to a blank workspace"));

    expect(window.confirm).toHaveBeenCalledWith(
      "Delete all workspace content and reset to a blank Home page? A backup will be attempted first.",
    );
    expect(store.resetWorkspace).not.toHaveBeenCalled();
  });

  it("switches the global theme and the SPS theme together", async () => {
    render(<CommandPalette />);

    fireEvent.mouseDown(await screen.findByText("Switch to dark"));

    expect(theme.setTheme).toHaveBeenCalledWith("dark");
    expect(store.setTweak).toHaveBeenCalledWith("dark", true);
  });

  it("stays compact for commands and previews document results only", async () => {
    const { container } = render(<CommandPalette />);

    await screen.findAllByText("What's new");
    expect(container.querySelector(".palette.has-preview")).toBeNull();
    expect(container.querySelector(".pal-preview")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Search or open in new tab…"), {
      target: { value: "Launch Notes" },
    });
    expect(await screen.findByText("Existing page text")).toBeInTheDocument();
    expect(container.querySelector(".palette.has-preview")).not.toBeNull();
  });

  it("offers what's new when update affordances are unseen", async () => {
    render(<CommandPalette />);

    const [actionLabel] = await screen.findAllByText("What's new");

    fireEvent.mouseDown(actionLabel);

    expect(store.setSurface).toHaveBeenCalledWith("doc");
  });

  it("offers what's new for engine-only available update cards", async () => {
    localStorage.setItem("hermes-desktop-last-seen-version", "0.5.4");
    api.getHermesUpstreamWatchState.mockResolvedValue({
      lastRunAt: "2026-07-03T12:00:00.000Z",
      lastSeenCommit: "fed789",
      lastSeenRelease: "v2026.7.3",
      latestReportPath: "/tmp/upstream-watch/2026-07-03.md",
      classifiedCounts: { "contract-risk": 1 },
      anchorSha: "abc123",
      pendingCommitCount: 2,
      contractRiskCount: 1,
      availableUpdate: {
        range: "abc123..fed789",
        anchorSha: "abc123",
        headSha: "fed789",
        generatedAt: "2026-07-03T12:00:00.000Z",
        pendingCommitCount: 2,
        contractRiskCount: 1,
        cards: [
          {
            id: "engine-abc123-fed789-0",
            source: "engine",
            range: "abc123..fed789",
            title: "Gateway update available",
            body: "A pending Hermes Agent update changes gateway capability reporting.",
            cta: "Review update",
            action: { kind: "settings", view: "providers" },
          },
        ],
      },
    });
    render(<CommandPalette />);

    const [actionLabel] = await screen.findAllByText("What's new");
    expect(
      screen.queryByText("Review 1 available Hermes Agent update."),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".pal-preview")).toBeNull();

    fireEvent.mouseDown(actionLabel);

    expect(store.setSurface).toHaveBeenCalledWith("doc");
  });

  it("opens Content Studio after saving selected workspace text as a content idea", async () => {
    render(<CommandPalette />);

    fireEvent.mouseDown(screen.getByText("Save selection as content idea"));

    await waitFor(() =>
      expect(api.spsExportRow).toHaveBeenCalledWith(
        "content-ideas",
        "content-idea-launch-notes",
        expect.stringContaining('type: "content-idea"'),
      ),
    );
    const markdown = String(api.spsExportRow.mock.calls.at(-1)?.[2] ?? "");
    expect(markdown).toContain("Selected proof that should become a draft angle.");
    expect(markdown).toContain('capturedFrom: "workspace-selection"');
    expect(store.openContentStudioIdea).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Launch Notes",
        sourceUrls: [],
        angle: "Selected proof that should become a draft angle.",
        capturedFrom: "workspace-selection",
      }),
    );
  });
});
