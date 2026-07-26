// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const storeState = vi.hoisted(() => ({
  meta: {} as Record<string, unknown>,
  selectPage: vi.fn(),
  setSurface: vi.fn(),
  setOpenTask: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (s: unknown) => unknown) => selector(storeState),
}));

const vaultRows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: () => ({ rows: vaultRows.value, refetch: vi.fn() }),
}));

const listCronJobs = vi.fn();
const srList = vi.fn();
vi.mock("../../../lib/api/scheduler", () => ({
  listCronJobs: (...args: unknown[]) => listCronJobs(...args),
  srList: (...args: unknown[]) => srList(...args),
}));

import { TodaySurface } from "./TodaySurface";
import { localDateKey } from "./todayModel";

const TODAY = localDateKey();

beforeEach(() => {
  vi.clearAllMocks();
  storeState.meta = {};
  vaultRows.value = [];
  listCronJobs.mockResolvedValue([]);
  srList.mockResolvedValue([]);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: { appLaunchListSchedules: vi.fn().mockResolvedValue([]) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TodaySurface — the brief card", () => {
  it("offers to read today's brief when the engine wrote one", async () => {
    storeState.meta = { [`daily-brief-${TODAY}`]: { title: "Brief" } };
    render(<TodaySurface />);
    expect(
      await screen.findByText("The agent wrote today’s brief."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Read it/ })).toBeTruthy();
  });

  it("says no brief has EVER been written, rather than showing an empty card", async () => {
    storeState.meta = { home: { title: "Home" } };
    render(<TodaySurface />);
    expect(
      await screen.findByText("No brief has ever been written."),
    ).toBeTruthy();
  });

  it("reports how stale the last brief is when today's is missing", async () => {
    // Six days back from today, whatever today happens to be.
    const past = new Date();
    past.setDate(past.getDate() - 6);
    storeState.meta = { [`daily-brief-${localDateKey(past)}`]: {} };
    render(<TodaySurface />);
    expect(
      await screen.findByText(
        "Today's brief has not arrived. The last one was 6 days ago.",
      ),
    ).toBeTruthy();
  });

  it("says 'yesterday' rather than '1 days ago'", async () => {
    const past = new Date();
    past.setDate(past.getDate() - 1);
    storeState.meta = { [`daily-brief-${localDateKey(past)}`]: {} };
    render(<TodaySurface />);
    expect(
      await screen.findByText(
        "Today's brief has not arrived. The last one was yesterday.",
      ),
    ).toBeTruthy();
  });

  it("opens the brief page on the doc surface", async () => {
    storeState.meta = { [`daily-brief-${TODAY}`]: {} };
    render(<TodaySurface />);
    (await screen.findByRole("button", { name: /Read it/ })).click();
    expect(storeState.selectPage).toHaveBeenCalledWith(`daily-brief-${TODAY}`);
    expect(storeState.setSurface).toHaveBeenCalledWith("doc");
  });
});

describe("TodaySurface — inbox and schedules", () => {
  it("hides the inbox card entirely when nothing is waiting", async () => {
    vaultRows.value = [
      { path: "a", title: "a", props: { status: "processed" }, mtime: 0 },
    ];
    render(<TodaySurface />);
    await screen.findByText("Your brief");
    expect(screen.queryByText("Inbox")).toBeNull();
  });

  it("counts captures waiting on triage", async () => {
    vaultRows.value = [
      { path: "a", title: "a", props: { status: "unprocessed" }, mtime: 0 },
      { path: "b", title: "b", props: { status: "processing" }, mtime: 0 },
      { path: "c", title: "c", props: { status: "processed" }, mtime: 0 },
    ];
    render(<TodaySurface />);
    expect(
      await screen.findByText("2 captures are waiting to be triaged."),
    ).toBeTruthy();
  });

  it("shows the next scheduled run", async () => {
    listCronJobs.mockResolvedValue([
      {
        id: "job-1",
        name: "Owner daily brief",
        schedule: "0 7 * * *",
        prompt: "",
        state: "active",
        enabled: true,
        next_run_at: "2036-07-27T01:30:00.000Z",
        last_run_at: null,
        last_status: null,
        last_error: null,
        repeat: null,
        deliver: [],
        skills: [],
        script: null,
      },
    ]);
    render(<TodaySurface />);
    expect(await screen.findByText("Owner daily brief")).toBeTruthy();
  });

  it("says nothing is scheduled when the list is empty", async () => {
    render(<TodaySurface />);
    await waitFor(() =>
      expect(
        screen.getByText("Nothing is scheduled to run next."),
      ).toBeTruthy(),
    );
  });
});
