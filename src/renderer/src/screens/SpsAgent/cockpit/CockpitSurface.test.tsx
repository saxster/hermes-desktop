import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorReadinessReport } from "../../../../../shared/operator-readiness";

const store = vi.hoisted(() => ({
  cockpit: [] as Array<{ kind: string; span: 1 | 2 }>,
  meta: {} as Record<string, { title: string }>,
  docs: {} as Record<string, Array<{ type: string; text: string }>>,
  reorderCockpit: vi.fn(),
  setCockpitSpan: vi.fn(),
  removeCockpitWidget: vi.fn(),
  addCockpitWidget: vi.fn(),
  resetCockpit: vi.fn(),
  setSurface: vi.fn(),
  setScheduledOpen: vi.fn(),
  selectPage: vi.fn(),
}));

const vaultRows = vi.hoisted(() => ({
  tasks: [] as Array<{ path: string; props: Record<string, unknown> }>,
  _inbox: [] as Array<{ path: string; props: Record<string, unknown> }>,
}));

const openSettings = vi.hoisted(() => vi.fn());

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: (scope: "tasks" | "_inbox") => ({
    rows: vaultRows[scope] ?? [],
    refetch: vi.fn(),
  }),
}));

vi.mock("../../../lib/openSettings", () => ({ openSettings }));

function readinessReport(): OperatorReadinessReport {
  return {
    profile: "default",
    status: "blocked",
    headline: "Blocked before serious use",
    summary: "1 blocked, 1 need attention, 0 ready.",
    generatedAt: 1,
    items: [
      {
        id: "ai",
        title: "AI setup",
        status: "blocked",
        summary: "Anthropic API key is missing.",
        action: {
          label: "Open AI Setup",
          target: { kind: "settings", view: "aiSetup" },
        },
      },
      {
        id: "review",
        title: "Review queue",
        status: "attention",
        summary: "1 pending vault proposal needs review.",
        action: {
          label: "Open Review Queue",
          target: { kind: "surface", surface: "review" },
        },
      },
    ],
  };
}

import { CockpitSurface } from "./CockpitSurface";

describe("CockpitSurface operator readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getOperatorReadiness: vi.fn().mockResolvedValue(readinessReport()),
        spsNagList: vi.fn().mockResolvedValue([]),
        spsListVaultProposals: vi.fn().mockResolvedValue([]),
        gatewayHealthStatus: vi.fn().mockResolvedValue("healthy"),
        getHermesVersion: vi.fn().mockResolvedValue("0.16.0"),
        getHermesAgentUpdateRoutine: vi.fn().mockResolvedValue({
          channel: "release",
          lastResult: { status: "current", releaseTag: "v0.16.0" },
        }),
        equityListAlerts: vi.fn().mockResolvedValue([]),
        onEquityAlert: vi.fn().mockReturnValue(vi.fn()),
      },
    });
  });

  afterEach(() => {
    store.cockpit = [];
    store.meta = {};
    store.docs = {};
    vaultRows.tasks = [];
    vaultRows._inbox = [];
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("shows readiness and routes fix actions from the cockpit", async () => {
    render(<CockpitSurface />);

    expect(
      await screen.findByText("Blocked before serious use"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open AI Setup" }));
    expect(openSettings).toHaveBeenCalledWith("aiSetup");

    fireEvent.click(screen.getByRole("button", { name: "Open Review Queue" }));
    expect(store.setSurface).toHaveBeenCalledWith("review");
  });

  it("renders the six operator widgets from their live sources and routes them", async () => {
    store.cockpit = [
      { kind: "tasksNags", span: 1 },
      { kind: "triage", span: 1 },
      { kind: "brief", span: 2 },
      { kind: "approvals", span: 1 },
      { kind: "engine", span: 1 },
      { kind: "equityAlerts", span: 2 },
    ];
    store.meta = { brief1: { title: "Daily Brief - 2026-07-13" } };
    store.docs = {
      brief1: [
        { type: "h1", text: "Daily Brief" },
        { type: "p", text: "Review the owner queue before lunch." },
      ],
    };
    vaultRows.tasks = [
      { path: "tasks/one.md", props: { status: "doing" } },
      { path: "tasks/two.md", props: { status: "done" } },
    ];
    vaultRows._inbox = [
      { path: "_inbox/a.md", props: { status: "unprocessed" } },
      { path: "_inbox/b.md", props: { status: "unprocessed" } },
    ];
    const api = window.hermesAPI;
    vi.mocked(api.spsNagList).mockResolvedValue([
      {
        rowId: "tasks/one",
        nagCount: 1,
        nextNagAt: 0,
        cadence: "daily",
      },
    ]);
    vi.mocked(api.spsListVaultProposals).mockResolvedValue([
      {
        id: "proposal-1",
        title: "Create task",
        summary: "Telegram task request",
        source: "telegram",
        status: "pending",
        createdAt: 1,
        updatedAt: 1,
        operations: [],
      },
    ]);
    vi.mocked(api.getHermesAgentUpdateRoutine).mockResolvedValue({
      enabled: true,
      autoApply: false,
      channel: "release",
      schedule: "0 9 * * *",
      timezone: "local",
      lastCheckedAt: null,
      nextCheckAt: "",
      lastResult: {
        checkedAt: "2026-07-13T00:00:00.000Z",
        status: "available",
        message: "Update available",
        releaseTag: "v0.16.0",
      },
      autoApplySuppressed: false,
      autoApplySuppressionReason: null,
      autoApplySuppressedAt: null,
      autoApplySuppressedSha: null,
    });
    vi.mocked(api.equityListAlerts).mockResolvedValue([
      {
        id: "alert-1",
        ts: "2026-07-13T07:00:00.000Z",
        ticker: "HDFCBANK",
        trigger: "regime",
        message: "Regime changed.",
      },
    ]);

    render(<CockpitSurface />);

    expect(await screen.findByText("proposal needs approval")).toBeVisible();
    expect(
      screen.getByText("Due nags").previousElementSibling,
    ).toHaveTextContent("1");
    expect(screen.getByText("captures awaiting triage")).toBeVisible();
    expect(
      screen.getByText("Review the owner queue before lunch."),
    ).toBeVisible();
    expect(await screen.findByText(/Update available/)).toBeVisible();
    expect(await screen.findByText("Regime changed.")).toBeVisible();

    fireEvent.click(screen.getByText("Open My Work"));
    expect(store.setSurface).toHaveBeenCalledWith("work");
    fireEvent.click(screen.getByText("Open Inbox"));
    expect(store.setSurface).toHaveBeenCalledWith("inbox");
    fireEvent.click(screen.getByText("Open brief"));
    expect(store.selectPage).toHaveBeenCalledWith("brief1");
    expect(store.setSurface).toHaveBeenCalledWith("doc");
    fireEvent.click(screen.getByText("Open Equity"));
    expect(store.setSurface).toHaveBeenCalledWith("equity");
  });
});
