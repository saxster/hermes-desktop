import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const store = vi.hoisted(() => ({
  t: { sidebar: "full" },
  page: "home",
  panelOpen: false,
  surface: "doc",
  chatNonce: 0,
  setPanelOpen: vi.fn(),
  setSurface: vi.fn(),
  setTemplatesOpen: vi.fn(),
  setResearchOpen: vi.fn(),
  setScheduledOpen: vi.fn(),
  setPaletteOpen: vi.fn(),
  setTweaksOpen: vi.fn(),
  ingestCommitPage: vi.fn(),
  flash: vi.fn(),
}));

const componentCalls = vi.hoisted(() => ({
  onboarding: vi.fn(),
  whatsNew: vi.fn(),
}));

let observedWorkspaceWidth = 1024;

class MockResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: { width: observedWorkspaceWidth },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  disconnect(): void {
    return;
  }
}

vi.mock("./store", () => {
  const useStore = Object.assign(
    (selector: (s: typeof store) => unknown): unknown => selector(store),
    { getState: (): typeof store => store },
  );
  return { useStore };
});

vi.mock("./hooks/useHotkeys", () => ({ useHotkeys: vi.fn() }));
vi.mock("./lib/scroll", () => ({ setScrollContainer: vi.fn() }));
vi.mock("./inbox/ingestApply", () => ({ runAutoIngest: vi.fn() }));
vi.mock("./inbox/ingestPrefs", () => ({
  getAutoApply: vi.fn(() => false),
  getIngestIntervalMin: vi.fn(() => 0),
  getLintIntervalMin: vi.fn(() => 0),
  INGEST_PREFS_EVENT: "sps-ingest-prefs",
}));
vi.mock("../../lib/openSettings", () => ({ openSettings: vi.fn() }));

vi.mock("./sidebar/Sidebar", () => ({ Sidebar: () => <aside>Sidebar</aside> }));
vi.mock("./shell/Topbar", () => ({ Topbar: () => <header>Topbar</header> }));
vi.mock("./shell/DocHeader", () => ({
  DocHeader: ({ children }: { children?: ReactNode }) => (
    <section className="doc" data-testid="doc-header">
      <h1>Home</h1>
      {children}
    </section>
  ),
}));
vi.mock("./editor/Editor", () => ({
  Editor: () => <div data-testid="editor">Editor</div>,
}));
vi.mock("./panel/RightPanel", () => ({
  RightPanel: () => <aside>Panel</aside>,
}));
vi.mock("./shell/Overlays", () => ({ Overlays: () => null }));
vi.mock("./components/Toast", () => ({ Toast: () => null }));
vi.mock("./components/SaveStatus", () => ({ SaveStatus: () => null }));
vi.mock("./components/OcrStatus", () => ({ OcrStatus: () => null }));

vi.mock("./components/OnboardingChecklist", () => ({
  OnboardingChecklist: (props: { variant?: string }) => {
    componentCalls.onboarding(props);
    return (
      <div
        className={
          props.variant === "compact"
            ? "home-affordance-cluster"
            : "ob-checklist"
        }
        data-testid="onboarding-checklist"
        data-variant={props.variant ?? "card"}
      />
    );
  },
}));
vi.mock("./updates/WhatsNewPanel", () => ({
  WhatsNewPanel: (props: { variant?: string }) => {
    componentCalls.whatsNew(props);
    return (
      <section
        className={
          props.variant === "compact"
            ? "home-affordance-cluster"
            : "ob-checklist"
        }
        data-testid="whats-new-panel"
        data-variant={props.variant ?? "card"}
      />
    );
  },
}));

vi.mock("../Insights/Insights", () => ({ default: () => null }));
vi.mock("./you/MemoryTimeline", () => ({ MemoryTimeline: () => null }));
vi.mock("./shell/ChatSurface", () => ({ ChatSurface: () => null }));
vi.mock("./panel/AskPane", () => ({ AskPane: () => null }));
vi.mock("./graph/GraphView", () => ({ GraphView: () => null }));
vi.mock("./equity/EquityResearch", () => ({ EquityResearch: () => null }));
vi.mock("./journal/JournalSurface", () => ({ JournalSurface: () => null }));
vi.mock("./journal/MyWorkSurface", () => ({ MyWorkSurface: () => null }));
vi.mock("./you/YouSurface", () => ({ YouSurface: () => null }));
vi.mock("./learning/LearningSurface", () => ({ LearningSurface: () => null }));
vi.mock("./activeWork/ActiveWorkSurface", () => ({
  ActiveWorkSurface: () => null,
}));
vi.mock("./cockpit/CockpitSurface", () => ({ CockpitSurface: () => null }));
vi.mock("./inbox/InboxSurface", () => ({ InboxSurface: () => null }));
vi.mock("./health/HealthSurface", () => ({ HealthSurface: () => null }));
vi.mock("./review/ReviewQueueSurface", () => ({
  ReviewQueueSurface: () => null,
}));
vi.mock("./editor/ObsidianEditor", () => ({ ObsidianEditor: () => null }));
vi.mock("./health/PersonalHealthDashboard", () => ({
  PersonalHealthDashboard: () => null,
}));
vi.mock("./research/RssReaderDashboard", () => ({
  RssReaderDashboard: () => null,
}));
vi.mock("./modals/ResearchModal", () => ({
  ResearchModal: () => <div data-testid="research-workspace" />,
}));
vi.mock("./components/Dashboard", () => ({ Dashboard: () => null }));
vi.mock("./content/ContentStudioSurface", () => ({
  ContentStudioSurface: () => null,
}));
vi.mock("./deck/DeckStudioSurface", () => ({ DeckStudioSurface: () => null }));

import { App } from "./App";

beforeEach(() => {
  componentCalls.onboarding.mockClear();
  componentCalls.whatsNew.mockClear();
  store.surface = "doc";
  store.panelOpen = false;
  store.page = "home";
  store.setPanelOpen.mockClear();
  observedWorkspaceWidth = 1024;
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1100,
  });
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("SpsAgent App doc surface", () => {
  it("opens directly on the document without persistent onboarding chrome", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".home-affordance-strip")).toBeNull();
    expect(screen.getByTestId("doc-header")).toBeInTheDocument();
    expect(componentCalls.onboarding).not.toHaveBeenCalled();
    expect(componentCalls.whatsNew).not.toHaveBeenCalled();
  });

  it.each([
    [680, "compact"],
    [900, "standard"],
    [1280, "expanded"],
  ])(
    "derives the %s workspace width from usable content",
    (width, expected) => {
      observedWorkspaceWidth = width as number;

      const { container } = render(<App />);

      expect(container.querySelector(".app")).toHaveAttribute(
        "data-workspace-width",
        expected,
      );
    },
  );

  it("closes the document inspector when usable content enters compact mode", () => {
    store.panelOpen = true;
    observedWorkspaceWidth = 680;

    render(<App />);

    expect(store.setPanelOpen).toHaveBeenCalledWith(false);
  });

  it("uses the icon rail at the 900px minimum without changing the saved preference", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 900,
    });

    store.panelOpen = true;
    const { container } = render(<App />);

    expect(container.querySelector(".app")).toHaveAttribute(
      "data-rail",
      "icons",
    );
    expect(store.t.sidebar).toBe("full");
    expect(store.setPanelOpen).toHaveBeenCalledWith(false);
  });

  it("renders research as a persistent main workspace", () => {
    store.surface = "research";

    render(<App />);

    expect(screen.getByTestId("research-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("doc-header")).not.toBeInTheDocument();
  });
});
