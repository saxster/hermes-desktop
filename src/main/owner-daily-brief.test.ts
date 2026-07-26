import { beforeEach, describe, expect, it, vi } from "vitest";

const { settings } = vi.hoisted(() => ({
  settings: {
    channels: { macos: true, telegram: true, email: true },
    events: {
      "daily-brief": true,
      "scheduled-research": true,
      "gateway-outage": true,
      "follow-up": true,
      "task-proposal": true,
    },
    quietHours: { enabled: true, start: "22:00", end: "07:00" },
    minIntervalMinutes: 15,
    maxPerHour: 6,
  },
}));

vi.mock("./owner-delivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./owner-delivery")>();
  return { ...actual, getOwnerDeliverySettings: () => settings };
});

import type { CronJob } from "../shared/cronjobs";
import {
  OWNER_DAILY_BRIEF_JOB_NAME,
  OWNER_DAILY_BRIEF_SCHEDULE,
  dailyBriefPrompt,
  ownerDailyBriefDeliveryTarget,
  syncOwnerDailyBriefCron,
} from "./owner-daily-brief";

function job(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    name: OWNER_DAILY_BRIEF_JOB_NAME,
    schedule: OWNER_DAILY_BRIEF_SCHEDULE,
    prompt: dailyBriefPrompt("/vault/work"),
    state: "active",
    enabled: true,
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    repeat: null,
    deliver: ["local", "telegram", "email"],
    skills: [],
    script: null,
    ...overrides,
  };
}

function dependencies(
  jobs: CronJob[] = [],
): NonNullable<Parameters<typeof syncOwnerDailyBriefCron>[1]> {
  return {
    list: vi.fn(async () => jobs),
    create: vi.fn(async () => ({ success: true })),
    pause: vi.fn(async () => ({ success: true })),
    resume: vi.fn(async () => ({ success: true })),
    remove: vi.fn(async () => ({ success: true })),
    vaultDir: vi.fn(() => "/vault/work"),
    now: vi.fn(() => new Date(2026, 6, 13, 6, 0)),
  };
}

describe("owner daily brief cron", () => {
  beforeEach(() => {
    settings.channels.telegram = true;
    settings.channels.email = true;
    settings.events["daily-brief"] = true;
    settings.quietHours = { enabled: true, start: "22:00", end: "07:00" };
  });

  it("creates a 7:00 engine cron job with configured external channels and local audit output", async () => {
    const deps = dependencies();

    await expect(syncOwnerDailyBriefCron("work", deps)).resolves.toEqual({
      success: true,
      action: "created",
    });
    expect(deps.create).toHaveBeenCalledWith(
      "0 7 * * *",
      expect.stringContaining("/vault/work"),
      OWNER_DAILY_BRIEF_JOB_NAME,
      "local,telegram,email",
      "work",
    );
  });

  it("leaves the existing matching job unchanged", async () => {
    const deps = dependencies([job()]);

    await expect(syncOwnerDailyBriefCron("work", deps)).resolves.toEqual({
      success: true,
      action: "unchanged",
    });
    expect(deps.create).not.toHaveBeenCalled();
  });

  // The comparison used to cover only schedule and delivery targets, so an
  // existing job was "unchanged" forever and every edit to dailyBriefPrompt was
  // silently dropped — including the one that makes the engine write the page.
  it("recreates the job when the prompt has drifted from the current one", async () => {
    const deps = dependencies([job({ prompt: "an older brief prompt" })]);

    await expect(syncOwnerDailyBriefCron("work", deps)).resolves.toEqual({
      success: true,
      action: "updated",
    });
    expect(deps.remove).toHaveBeenCalledWith("job-1", "work");
    expect(deps.create).toHaveBeenCalledWith(
      "0 7 * * *",
      expect.stringContaining("sps_write_page"),
      OWNER_DAILY_BRIEF_JOB_NAME,
      "local,telegram,email",
      "work",
    );
  });

  it("tolerates an Operating rules block appended by augmentPrompt", async () => {
    const augmented = `${dailyBriefPrompt("/vault/work")}\n\nOperating rules:\n- Do not fabricate results.`;
    const deps = dependencies([job({ prompt: augmented })]);

    await expect(syncOwnerDailyBriefCron("work", deps)).resolves.toEqual({
      success: true,
      action: "unchanged",
    });
    expect(deps.create).not.toHaveBeenCalled();
  });

  it("instructs the engine to write the brief as a vault page", () => {
    const prompt = dailyBriefPrompt("/vault/work");

    expect(prompt).toContain("sps_write_page");
    expect(prompt).toContain("daily-brief-YYYY-MM-DD");
    // Page ids reject spaces, so the prompt must not ask for the old
    // "Daily Brief - <date>" filename shape.
    expect(prompt).not.toContain("pageId 'Daily Brief");
  });

  it("pauses the job when daily briefs are disabled", async () => {
    settings.events["daily-brief"] = false;
    const deps = dependencies([job()]);

    await expect(syncOwnerDailyBriefCron("work", deps)).resolves.toEqual({
      success: true,
      action: "paused",
    });
    expect(deps.pause).toHaveBeenCalledWith("job-1", "work");
  });

  it.each([
    {
      mutation: "pause",
      configure: () => {
        settings.events["daily-brief"] = false;
      },
      jobs: [job()],
    },
    {
      mutation: "resume",
      configure: () => undefined,
      jobs: [job({ state: "paused" })],
    },
    {
      mutation: "remove",
      configure: () => undefined,
      jobs: [job({ schedule: "0 8 * * *" })],
    },
    {
      mutation: "create",
      configure: () => undefined,
      jobs: [],
    },
  ])("throws when the $mutation mutation fails", async (testCase) => {
    testCase.configure();
    const deps = dependencies(testCase.jobs);
    const mutation = testCase.mutation as keyof typeof deps;
    // deps[mutation] is a union of mocks whose resolve types differ, so the
    // dynamic lookup is narrowed to the mock surface this case actually uses.
    const failing = deps[mutation] as ReturnType<typeof vi.fn>;
    failing.mockResolvedValue({
      success: false,
      error: `${testCase.mutation} failed`,
    });

    await expect(syncOwnerDailyBriefCron("work", deps)).rejects.toThrow(
      `${testCase.mutation} failed`,
    );
  });

  it("suppresses external delivery when 7:00 falls inside quiet hours", () => {
    settings.quietHours = { enabled: true, start: "23:00", end: "08:00" };

    expect(ownerDailyBriefDeliveryTarget("work")).toBe("local");
  });
});
