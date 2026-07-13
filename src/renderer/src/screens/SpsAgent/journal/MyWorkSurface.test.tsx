import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  setOpenTask: vi.fn(),
  setScheduledOpen: vi.fn(),
}));

const vaultRows = vi.hoisted(() => [
  {
    path: "tasks/task-1.md",
    title: "Finish design audit",
    props: { status: "doing", prio: "high", who: "you" },
    mtime: 1,
  },
  {
    path: "tasks/task-2.md",
    title: "Plan next release",
    props: { status: "todo", prio: "med", who: "you" },
    mtime: 1,
  },
]);

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("../hooks/useNoteIndex", () => ({
  useVaultQuery: () => ({ rows: vaultRows, refetch: vi.fn() }),
}));

vi.mock("../activeWork/ActiveWorkSurface", () => ({
  ActiveWorkSurface: () => <div>Active work</div>,
}));

vi.mock("../review/ReviewQueueSurface", () => ({
  ReviewQueueSurface: () => <div>Review queue</div>,
}));

import {
  localDateKey,
  MyWorkSurface,
  taskNeedsAttentionToday,
} from "./MyWorkSurface";

describe("MyWorkSurface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        srList: vi.fn().mockResolvedValue([]),
        appLaunchListSchedules: vi.fn().mockResolvedValue([]),
        appLaunchUpdateSchedule: vi.fn().mockResolvedValue({ ok: true }),
        listCronJobs: vi.fn().mockResolvedValue([]),
      },
    });
  });

  afterEach(() => {
    cleanup();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("starts with Today and keeps Journal out of the Work task flow", () => {
    render(<MyWorkSurface />);

    expect(screen.getByRole("tab", { name: "Today" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Finish design audit")).toBeInTheDocument();
    expect(screen.queryByText("Journal calendar")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Next" }));
    expect(screen.getByText("Plan next release")).toBeInTheDocument();
  });

  it("formats task due dates from local calendar fields instead of UTC", () => {
    const date = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 12,
      toISOString: () => "2026-07-11T19:00:00.000Z",
    } as Date;

    expect(localDateKey(date)).toBe("2026-07-12");
  });

  it("keeps overdue open tasks in Today", () => {
    expect(
      taskNeedsAttentionToday(
        {
          id: "tasks/overdue.md",
          title: "Overdue",
          status: "todo",
          prio: "high",
          who: "you",
          due: "2026-07-11",
          est: "",
        },
        "2026-07-12",
      ),
    ).toBe(true);
    expect(
      taskNeedsAttentionToday(
        {
          id: "tasks/future.md",
          title: "Future",
          status: "todo",
          prio: "low",
          who: "you",
          due: "2026-07-13",
          est: "",
        },
        "2026-07-12",
      ),
    ).toBe(false);
  });

  it("honors the human-readable due-date format advertised by Task Drawer", () => {
    expect(
      taskNeedsAttentionToday(
        {
          id: "tasks/human-date.md",
          title: "Human date",
          status: "todo",
          prio: "med",
          who: "you",
          due: "Jul 12",
          est: "",
        },
        "2026-07-13",
      ),
    ).toBe(true);
  });

  it("uses Scheduled vocabulary on the scheduled tab", async () => {
    const api = window.hermesAPI as unknown as {
      srList: ReturnType<typeof vi.fn>;
      appLaunchListSchedules: ReturnType<typeof vi.fn>;
      appLaunchUpdateSchedule: ReturnType<typeof vi.fn>;
      listCronJobs: ReturnType<typeof vi.fn>;
    };
    api.srList.mockResolvedValue([
      {
        id: "sr_1",
        kind: "research",
        topic: "AI agent launches",
        pageId: "ai-agent-launches",
        cadence: "weekly",
        hour: 8,
        autoApply: false,
        enabled: true,
        createdAt: 1,
        lastRunAt: 0,
        lastChangeHash: "",
      },
    ]);
    api.appLaunchListSchedules.mockResolvedValue([
      {
        id: "launch_1",
        label: "Morning apps",
        targetIds: ["target_1"],
        cadence: "daily",
        hour: 9,
        enabled: true,
        runWhenClosed: false,
        createdAt: 1,
        updatedAt: 1,
        lastRunAt: 0,
      },
    ]);
    api.listCronJobs.mockResolvedValue([
      {
        id: "cron_1",
        name: "Smoke skipped job",
        schedule: "*/5 * * * *",
        prompt: "Run the smoke job.",
        state: "active",
        enabled: true,
        next_run_at: null,
        last_run_at: null,
        last_status: "skipped",
        last_error: null,
        repeat: null,
        deliver: [],
        skills: [],
        script: null,
      },
    ]);

    render(<MyWorkSurface />);
    fireEvent.click(screen.getByRole("tab", { name: "Scheduled" }));

    expect(await screen.findByText(/Topic monitor ·/)).toBeInTheDocument();
    expect(await screen.findByText(/Launch recipe ·/)).toBeInTheDocument();
    expect(await screen.findByText(/Agent job ·/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage scheduled items" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Pause" })[1]);
    await waitFor(() =>
      expect(api.appLaunchUpdateSchedule).toHaveBeenCalledWith("launch_1", {
        enabled: false,
      }),
    );
    expect(screen.queryByText(/Signal Brief/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/background jobs/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Manage rules/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scheduled rules/i)).not.toBeInTheDocument();
  });
});
