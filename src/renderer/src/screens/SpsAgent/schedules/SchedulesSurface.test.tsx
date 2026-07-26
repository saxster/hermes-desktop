// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const setScheduledOpen = vi.fn();
vi.mock("../store", () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({ setScheduledOpen }),
}));

const triggerCronJob = vi.fn().mockResolvedValue({ success: true });
const removeCronJob = vi.fn().mockResolvedValue({ success: true });
const pauseCronJob = vi.fn().mockResolvedValue({ success: true });
const resumeCronJob = vi.fn().mockResolvedValue({ success: true });
const listCronJobs = vi.fn();
const srList = vi.fn();
const srUpdate = vi.fn().mockResolvedValue({ success: true });

vi.mock("../../../lib/api/scheduler", () => ({
  listCronJobs: (...args: unknown[]) => listCronJobs(...args),
  pauseCronJob: (...args: unknown[]) => pauseCronJob(...args),
  removeCronJob: (...args: unknown[]) => removeCronJob(...args),
  resumeCronJob: (...args: unknown[]) => resumeCronJob(...args),
  srList: (...args: unknown[]) => srList(...args),
  srUpdate: (...args: unknown[]) => srUpdate(...args),
  triggerCronJob: (...args: unknown[]) => triggerCronJob(...args),
}));

import { SchedulesSurface } from "./SchedulesSurface";

const CRON = {
  id: "job-1",
  name: "Owner daily brief",
  schedule: "0 7 * * *",
  prompt: "brief me",
  state: "active" as const,
  enabled: true,
  next_run_at: "2026-07-27T01:30:00.000Z",
  last_run_at: "2026-07-26T01:30:00.000Z",
  last_status: "ok",
  last_error: null,
  repeat: null,
  deliver: [],
  skills: [],
  script: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  listCronJobs.mockResolvedValue([CRON]);
  srList.mockResolvedValue([]);
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      appLaunchListSchedules: vi.fn().mockResolvedValue([]),
      appLaunchUpdateSchedule: vi.fn().mockResolvedValue({ ok: true }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SchedulesSurface", () => {
  it("lists a cron job with its cadence and next run", async () => {
    render(<SchedulesSurface />);
    expect(await screen.findByText("Owner daily brief")).toBeTruthy();
    expect(screen.getByText(/Agent job · 0 7 \* \* \*/)).toBeTruthy();
  });

  it("fires a job on demand — the action that used to require the modal", async () => {
    render(<SchedulesSurface />);
    const run = await screen.findByRole("button", {
      name: "Run Owner daily brief now",
    });
    fireEvent.click(run);
    await waitFor(() => expect(triggerCronJob).toHaveBeenCalledWith("job-1"));
  });

  it("pauses an active job", async () => {
    render(<SchedulesSurface />);
    const pause = await screen.findByRole("button", {
      name: "Pause Owner daily brief",
    });
    fireEvent.click(pause);
    await waitFor(() => expect(pauseCronJob).toHaveBeenCalledWith("job-1"));
  });

  it("resumes a paused job", async () => {
    listCronJobs.mockResolvedValue([{ ...CRON, state: "paused" }]);
    render(<SchedulesSurface />);
    const resume = await screen.findByRole("button", {
      name: "Resume Owner daily brief",
    });
    fireEvent.click(resume);
    await waitFor(() => expect(resumeCronJob).toHaveBeenCalledWith("job-1"));
  });

  it("confirms before deleting, and does nothing when declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<SchedulesSurface />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Owner daily brief" }),
    );
    expect(removeCronJob).not.toHaveBeenCalled();
  });

  it("deletes once confirmed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SchedulesSurface />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete Owner daily brief" }),
    );
    await waitFor(() => expect(removeCronJob).toHaveBeenCalledWith("job-1"));
  });

  it("surfaces a failing last run instead of letting it pass as healthy", async () => {
    listCronJobs.mockResolvedValue([
      { ...CRON, last_status: "error", last_error: "skill not found" },
    ]);
    render(<SchedulesSurface />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Owner daily brief");
  });

  it("still renders the other sources when one of the three fails to load", async () => {
    srList.mockRejectedValue(new Error("scheduler offline"));
    render(<SchedulesSurface />);
    expect(await screen.findByText("Owner daily brief")).toBeTruthy();
  });

  it("says so plainly when nothing is scheduled", async () => {
    listCronJobs.mockResolvedValue([]);
    render(<SchedulesSurface />);
    expect(await screen.findByText(/Nothing is scheduled yet/)).toBeTruthy();
  });

  it("will not offer to run or delete a completed job", async () => {
    listCronJobs.mockResolvedValue([{ ...CRON, state: "completed" }]);
    render(<SchedulesSurface />);
    await screen.findByText("Owner daily brief");
    expect(
      screen.queryByRole("button", { name: "Run Owner daily brief now" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Pause Owner daily brief" }),
    ).toBeNull();
  });
});
