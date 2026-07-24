import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  tree: [] as { id: string; children: { id: string; children: never[] }[] }[],
  meta: {} as Record<string, { title: string; journal?: boolean }>,
  page: "home",
  surface: "doc",
  t: { homeSurface: "doc", sidebar: "full" },
  sectionsEnabled: {
    aiAssistant: true,
    workspaceTools: false,
    recents: false,
    private: false,
  },
  sectionsOpen: {
    aiAssistant: true,
    workspaceTools: false,
    recents: false,
    private: false,
  },
  setSurface: vi.fn(),
  selectPage: vi.fn(),
  openJournal: vi.fn(),
  startNewChat: vi.fn(),
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  setAgentTasksOpen: vi.fn(),
  newSubPage: vi.fn(),
  renamePage: vi.fn(),
  deletePage: vi.fn(),
  movePage: vi.fn(),
  setPaletteOpen: vi.fn(),
  setTemplatesOpen: vi.fn(),
  setTrashOpen: vi.fn(),
  setTweaksOpen: vi.fn(),
  setTweak: vi.fn(),
  importPdf: vi.fn(),
  toggleSection: vi.fn(),
}));
const openSettings = vi.hoisted(() => vi.fn());

vi.mock("../store", () => ({
  useStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: () => ({ rows: [] }),
}));

vi.mock("./SidebarRecents", () => ({ SidebarRecents: () => null }));
vi.mock("./TreeNode", () => ({
  TreeNode: (props: {
    node: { id: string };
    meta: Record<string, { title: string }>;
  }) => <div>{props.meta[props.node.id]?.title}</div>,
}));
vi.mock("./ObsidianExplorer", () => ({ ObsidianExplorer: () => null }));
vi.mock("./StatusChip", () => ({ StatusChip: () => null }));
vi.mock("../../../lib/openSettings", () => ({ openSettings }));

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    store.setSurface.mockClear();
    openSettings.mockClear();
    store.tree = [];
    store.meta = {};
    store.sectionsEnabled.private = false;
    store.sectionsOpen.private = false;
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: { listProfiles: vi.fn().mockResolvedValue([]) },
    });
  });

  afterEach(() => {
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("shows the core loop by default", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Capture"));
    fireEvent.click(screen.getByText("Work"));
    fireEvent.click(screen.getByText("Assistant"));

    expect(screen.getByText("Packs")).toBeTruthy();
    expect(screen.getByText("Core")).toBeTruthy();
    expect(screen.queryByText("Content Studio")).toBeNull();
    expect(store.setSurface).toHaveBeenCalledWith("inbox");
    expect(store.setSurface).toHaveBeenCalledWith("work");
    expect(store.setSurface).toHaveBeenCalledWith("chats");
  });

  it("labels primary rail actions for icon-only mode", () => {
    render(<Sidebar />);

    for (const label of ["Search", "Home", "Capture", "Work", "Assistant"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button.getAttribute("title")).toBe(label);
      expect(button.getAttribute("aria-label")).toBe(label);
    }
  });

  it("keeps Content Studio storage pages out of everyday navigation", () => {
    store.sectionsEnabled.private = true;
    store.sectionsOpen.private = true;
    store.tree = [
      {
        id: "content-root",
        children: [{ id: "content-ideas", children: [] }],
      },
      { id: "notes", children: [] },
    ];
    store.meta = {
      "content-root": { title: "Content Studio" },
      "content-ideas": { title: "Ideas" },
      notes: { title: "Notes" },
    };

    render(<Sidebar />);

    expect(screen.queryByText("Content Studio")).toBeNull();
    expect(screen.queryByText("Ideas")).toBeNull();
    expect(screen.getByText("Notes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
  });

  it("renders Home only once when it is also the workspace root", () => {
    store.sectionsEnabled.private = true;
    store.sectionsOpen.private = true;
    store.tree = [
      { id: "home", children: [] },
      { id: "notes", children: [] },
    ];
    store.meta = {
      home: { title: "Home" },
      notes: { title: "Notes" },
    };

    render(<Sidebar />);

    expect(screen.getAllByText("Home")).toHaveLength(1);
    expect(screen.getByText("Notes")).toBeTruthy();
  });

  it("puts personalization, appearance, and Settings in one profile menu", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Open profile menu" }));
    expect(
      screen.getByRole("menuitem", { name: "Personalize My Assistant" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Appearance" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: /Settings/ }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu", { name: "Profile menu" })).toBeNull();
  });

  it("uses the effective responsive icon mode and dismisses the profile menu", () => {
    render(<Sidebar displayMode="icons" />);

    const packButtons = [
      "Learning",
      "Research",
      "Graph",
      "Health",
      "Equity",
      "Content",
      "Deck",
      "Obsidian",
    ].map((label) => screen.getByRole("button", { name: `Enable ${label}` }));
    expect(
      new Set(
        packButtons.map(
          (button) => button.querySelector("svg")?.innerHTML ?? "",
        ),
      ).size,
    ).toBeGreaterThan(4);
    const profileButton = screen.getByRole("button", {
      name: "Open profile menu",
    });
    fireEvent.click(profileButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Profile menu" })).toBeNull();
    expect(profileButton).toHaveFocus();

    fireEvent.click(profileButton);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Profile menu" })).toBeNull();
  });
});
