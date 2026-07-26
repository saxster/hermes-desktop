import { describe, expect, it } from "vitest";
import {
  epochFromIso,
  formatWhen,
  isFailing,
  nextUp,
  rowFromCron,
  rowFromLaunch,
  rowFromResearch,
  sortByNextRun,
  type ScheduleRow,
} from "./scheduleModel";
import type { CronJob } from "../../../../../shared/cronjobs";
import type { AppLaunchSchedule } from "../../../../../shared/app-launcher";
import type { ScheduledResearchItem } from "../../../../../shared/scheduledResearch";

function cron(patch: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    name: "Owner daily brief",
    schedule: "0 7 * * *",
    prompt: "brief me",
    state: "active",
    enabled: true,
    next_run_at: "2026-07-27T01:30:00.000Z",
    last_run_at: "2026-07-26T01:30:00.000Z",
    last_status: "ok",
    last_error: null,
    repeat: null,
    deliver: [],
    skills: [],
    script: null,
    ...patch,
  };
}

function research(
  patch: Partial<ScheduledResearchItem> = {},
): ScheduledResearchItem {
  return {
    id: "sr-1",
    topic: "Indian equity flows",
    pageId: "equity-flows",
    cadence: "daily",
    hour: 7,
    autoApply: false,
    enabled: true,
    createdAt: 0,
    lastRunAt: 1_785_000_000_000,
    lastChangeHash: "",
    ...patch,
  } as ScheduledResearchItem;
}

function launch(patch: Partial<AppLaunchSchedule> = {}): AppLaunchSchedule {
  return {
    id: "al-1",
    label: "Morning apps",
    targetIds: [],
    cadence: "daily",
    hour: 9,
    enabled: true,
    runWhenClosed: false,
    createdAt: 0,
    updatedAt: 0,
    lastRunAt: 0,
    ...patch,
  } as AppLaunchSchedule;
}

describe("epochFromIso", () => {
  it("returns null for absent or unparseable input", () => {
    expect(epochFromIso(null)).toBeNull();
    expect(epochFromIso(undefined)).toBeNull();
    expect(epochFromIso("not a date")).toBeNull();
  });

  it("parses an ISO string", () => {
    expect(epochFromIso("2026-07-27T01:30:00.000Z")).toBe(
      Date.parse("2026-07-27T01:30:00.000Z"),
    );
  });
});

describe("adapters", () => {
  it("maps a cron job, including its published next run", () => {
    const row = rowFromCron(cron());
    expect(row.source).toBe("agent");
    expect(row.label).toBe("Owner daily brief");
    expect(row.cadence).toBe("0 7 * * *");
    expect(row.nextRunAt).toBe(Date.parse("2026-07-27T01:30:00.000Z"));
    expect(row.canRunNow).toBe(true);
    expect(row.canDelete).toBe(true);
  });

  it("will not offer to run a completed cron job", () => {
    expect(rowFromCron(cron({ state: "completed" })).canRunNow).toBe(false);
  });

  it("maps a research monitor without inventing a next run", () => {
    const row = rowFromResearch(research(), "Every day at 07:00");
    expect(row.source).toBe("monitor");
    expect(row.label).toBe("Indian equity flows");
    expect(row.cadence).toBe("Every day at 07:00");
    // The cadence is known; the next fire time is not published anywhere.
    expect(row.nextRunAt).toBeNull();
    expect(row.canRunNow).toBe(false);
  });

  it("labels a digest schedule by its kind, not its topic", () => {
    const row = rowFromResearch(research({ kind: "digest" }), "Weekly");
    expect(row.source).toBe("digest");
    expect(row.label).toBe("External sessions");
  });

  it("maps a launch recipe and reads a never-run timestamp as null", () => {
    const row = rowFromLaunch(launch(), "Every day at 09:00");
    expect(row.source).toBe("launch");
    expect(row.lastRunAt).toBeNull();
  });

  it("marks a disabled source as paused", () => {
    expect(rowFromLaunch(launch({ enabled: false }), "Daily").state).toBe(
      "paused",
    );
  });
});

describe("sortByNextRun", () => {
  it("orders by soonest, and puts cadence-only rows last", () => {
    const rows: ScheduleRow[] = [
      rowFromResearch(research({ topic: "Zulu" }), "Daily"),
      rowFromCron(cron({ id: "b", next_run_at: "2026-07-27T09:00:00.000Z" })),
      rowFromCron(cron({ id: "a", next_run_at: "2026-07-27T02:00:00.000Z" })),
      rowFromResearch(research({ id: "sr-2", topic: "Alpha" }), "Daily"),
    ];
    const order = sortByNextRun(rows).map((r) => r.id);
    expect(order).toEqual(["a", "b", "sr-2", "sr-1"]);
  });

  it("does not mutate its input", () => {
    const rows = [
      rowFromCron(cron({ id: "b", next_run_at: "2026-07-27T09:00:00.000Z" })),
      rowFromCron(cron({ id: "a", next_run_at: "2026-07-27T02:00:00.000Z" })),
    ];
    sortByNextRun(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("nextUp", () => {
  it("keeps only what will actually fire, soonest first", () => {
    const rows: ScheduleRow[] = [
      rowFromCron(cron({ id: "paused", state: "paused" })),
      rowFromCron(cron({ id: "off", enabled: false })),
      rowFromCron(cron({ id: "done", state: "completed" })),
      rowFromResearch(research(), "Daily"),
      rowFromCron(
        cron({ id: "soon", next_run_at: "2026-07-27T02:00:00.000Z" }),
      ),
      rowFromCron(
        cron({ id: "later", next_run_at: "2026-07-27T09:00:00.000Z" }),
      ),
    ];
    expect(nextUp(rows, 5).map((r) => r.id)).toEqual(["soon", "later"]);
  });

  it("respects the limit", () => {
    const rows = [
      rowFromCron(cron({ id: "a", next_run_at: "2026-07-27T02:00:00.000Z" })),
      rowFromCron(cron({ id: "b", next_run_at: "2026-07-27T03:00:00.000Z" })),
      rowFromCron(cron({ id: "c", next_run_at: "2026-07-27T04:00:00.000Z" })),
    ];
    expect(nextUp(rows, 2).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("isFailing", () => {
  it("is false for an ok run and true for anything else", () => {
    expect(isFailing(rowFromCron(cron({ last_status: "ok" })))).toBe(false);
    expect(isFailing(rowFromCron(cron({ last_status: "success" })))).toBe(
      false,
    );
    expect(isFailing(rowFromCron(cron({ last_status: "error" })))).toBe(true);
  });

  it("is true when an error is recorded even if the status reads ok", () => {
    const row = rowFromCron(cron({ last_status: "ok", last_error: "boom" }));
    expect(isFailing(row)).toBe(true);
  });

  it("is false when nothing has run yet", () => {
    expect(isFailing(rowFromCron(cron({ last_status: null })))).toBe(false);
  });
});

describe("formatWhen", () => {
  it("reads a missing or zero timestamp as never", () => {
    expect(formatWhen(null)).toBe("never");
    expect(formatWhen(0)).toBe("never");
  });

  it("renders a real timestamp", () => {
    expect(formatWhen(Date.parse("2026-07-26T07:00:00.000Z"))).not.toBe(
      "never",
    );
  });
});
