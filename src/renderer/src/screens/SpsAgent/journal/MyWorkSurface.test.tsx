import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  docs: {
    home: [
      {
        id: "db",
        type: "database",
        text: "",
        rows: [
          {
            id: "task-1",
            title: "Finish design audit",
            status: "doing",
            prio: "high",
            who: "you",
            due: "",
            est: "",
          },
          {
            id: "task-2",
            title: "Plan next release",
            status: "todo",
            prio: "med",
            who: "you",
            due: "",
            est: "",
          },
        ],
      },
    ],
  },
  setOpenTask: vi.fn(),
  setScheduledOpen: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

vi.mock("../activeWork/ActiveWorkSurface", () => ({
  ActiveWorkSurface: () => <div>Active work</div>,
}));

vi.mock("../review/ReviewQueueSurface", () => ({
  ReviewQueueSurface: () => <div>Review queue</div>,
}));

import { MyWorkSurface } from "./MyWorkSurface";

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
