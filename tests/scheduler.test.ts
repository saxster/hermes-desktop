import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock electron desktopCapturer and app
vi.mock("electron", () => {
  const mockThumbnail = {
    toPNG: () => Buffer.from("fake-png-data"),
  };
  return {
    app: {
      isReady: () => true,
    },
    powerMonitor: {
      getSystemIdleTime: () => 0,
    },
    desktopCapturer: {
      getSources: async () => [{ thumbnail: mockThumbnail }],
    },
  };
});

// Mocking dependencies
const mockSpawn = vi.fn();
const mockListCronJobs = vi.fn();
const mockEngineCronTickerIsAlive = vi.fn(async () => false);
const mockTriggerSelfHealing = vi.fn();
const mockProfileHome = vi.fn((_profile: string) => "/tmp/hermes-test-profile");
const mockWriteDesktopConfig = vi.fn();
const mockReadDesktopConfig = vi.fn(() => ({}));
const mockMaybeRunHermesAgentUpdateRoutine = vi.fn();
const mockMaybeRunHermesUpstreamWatchRoutine = vi.fn();
const mockMaybeRunDesktopUpdateRoutine = vi.fn();
const mockMaybeRunAppLaunchSchedules = vi.fn();
const mockLogEnd = vi.fn();
const mockLogWriteAfterEnd = vi.fn();
const mockRetryQueuedOwnerDeliveries = vi.fn();
const mockCreateActiveWorkRun = vi.fn();
const mockUpdateActiveWorkRun = vi.fn();
const processHandlers = new Map<string, (...args: unknown[]) => void>();
const outputHandlers = new Map<string, (chunk: unknown) => void>();
let mockAutoClose = true;
let mockConnectionMode: "local" | "remote" | "ssh" = "local";

vi.mock("child_process", () => {
  const fns = {
    spawn: (...args: unknown[]) => {
      mockSpawn(...args);
      return {
        stdout: {
          on: (event: string, callback: (chunk: unknown) => void) => {
            outputHandlers.set(`stdout:${event}`, callback);
          },
        },
        stderr: {
          on: (event: string, callback: (chunk: unknown) => void) => {
            outputHandlers.set(`stderr:${event}`, callback);
          },
        },
        kill: vi.fn(),
        on: (event: string, callback: (...args: unknown[]) => void) => {
          processHandlers.set(event, callback);
          if (event === "close" && mockAutoClose) {
            setTimeout(() => callback(0), 10);
          }
        },
      };
    },
  };
  return { ...fns, default: fns };
});

vi.mock("fs", () => {
  let ended = false;
  const mockWrite = vi.fn(() => {
    if (ended) mockLogWriteAfterEnd();
  });
  const fns = {
    existsSync: (p: string) => !p.endsWith(".lock"),
    mkdirSync: () => {},
    createWriteStream: () => {
      ended = false;
      return {
        write: mockWrite,
        end: () => {
          ended = true;
          mockLogEnd();
        },
      };
    },
    readFileSync: () => "{}",
    writeFileSync: () => {},
  };
  return { ...fns, default: fns };
});

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-test-home",
  HERMES_PYTHON: "python",
  hermesCliArgs: () => [],
}));

vi.mock("../src/main/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/utils")>();
  return {
    ...actual,
    getActiveProfileNameSync: () => "test-profile",
    profileHome: (p: string) => mockProfileHome(p),
  };
});

vi.mock("../src/main/learning-proposals", () => ({
  createLearningProposal: vi.fn(),
}));

vi.mock("../src/main/skills", () => ({
  listInstalledSkills: vi.fn(() => []),
  getSkillContent: vi.fn(() => ""),
}));

vi.mock("../src/main/cronjobs", () => ({
  listCronJobs: () => mockListCronJobs(),
  engineCronTickerIsAlive: () => mockEngineCronTickerIsAlive(),
}));

vi.mock("../src/main/self-healing", () => ({
  triggerSelfHealing: (...args: unknown[]) => mockTriggerSelfHealing(...args),
}));

vi.mock("../src/main/hermes-agent-updates", () => ({
  maybeRunHermesAgentUpdateRoutine: (
    now: Date,
    profile?: string,
  ): Promise<unknown> => mockMaybeRunHermesAgentUpdateRoutine(now, profile),
}));

vi.mock("../src/main/hermes-upstream-watch", () => ({
  maybeRunHermesUpstreamWatchRoutine: (
    now: Date,
    profile?: string,
  ): Promise<unknown> => mockMaybeRunHermesUpstreamWatchRoutine(now, profile),
}));

vi.mock("../src/main/desktop-update-routine", () => ({
  maybeRunDesktopUpdateRoutine: (now: Date): Promise<unknown> =>
    mockMaybeRunDesktopUpdateRoutine(now),
}));

vi.mock("../src/main/app-launcher", () => ({
  maybeRunAppLaunchSchedules: (now: Date, profile?: string): Promise<unknown> =>
    mockMaybeRunAppLaunchSchedules(now, profile),
}));

vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (c: unknown) => mockWriteDesktopConfig(c),
  readEnv: () => ({}),
  getConnectionConfig: () => ({ mode: mockConnectionMode }),
}));

vi.mock("../src/main/owner-delivery", () => ({
  retryQueuedOwnerDeliveries: (profile?: string): Promise<unknown> =>
    mockRetryQueuedOwnerDeliveries(profile),
}));

vi.mock("../src/main/active-work-runs", () => ({
  createActiveWorkRun: (...args: unknown[]) => mockCreateActiveWorkRun(...args),
  updateActiveWorkRun: (...args: unknown[]) => mockUpdateActiveWorkRun(...args),
}));

// The nag engine is its own unit (see scheduler-nag.test.ts); stub it here so
// the scheduler tick test doesn't pull in note-index / better-sqlite3.
vi.mock("../src/main/nag-engine", () => ({
  nagTick: vi.fn(async () => {}),
}));

import {
  tickScheduler,
  getSchedulerConfig,
  setSchedulerConfig,
  captureScreenshot,
  runJobHeadless,
} from "../src/main/scheduler";

describe("Scheduler Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEngineCronTickerIsAlive.mockResolvedValue(false);
    mockMaybeRunHermesAgentUpdateRoutine.mockResolvedValue(null);
    mockMaybeRunHermesUpstreamWatchRoutine.mockResolvedValue(null);
    mockMaybeRunDesktopUpdateRoutine.mockResolvedValue(null);
    mockMaybeRunAppLaunchSchedules.mockResolvedValue([]);
    mockTriggerSelfHealing.mockResolvedValue(undefined);
    mockRetryQueuedOwnerDeliveries.mockResolvedValue({
      delivered: [],
      skipped: [],
    });
    const trackedRun = {
      contractVersion: 2,
      id: "work-cron",
      source: "cron-job",
      trigger: "cron",
      reviewPolicy: "review-first",
      attempt: 1,
      status: "running",
      title: "Cron job",
      goal: "Run cron job",
      criteria: [{ id: "crit-1", text: "Produce output", done: false }],
      expectedArtifacts: [
        { kind: "transcript", label: "Run transcript", required: true },
      ],
      artifacts: [],
      createdAt: 1,
      updatedAt: 1,
    };
    mockCreateActiveWorkRun.mockResolvedValue(trackedRun);
    mockUpdateActiveWorkRun.mockImplementation(
      async (_id: string, patch: Record<string, unknown>) => ({
        ...trackedRun,
        ...patch,
      }),
    );
    mockAutoClose = true;
    mockConnectionMode = "local";
    processHandlers.clear();
    outputHandlers.clear();
  });

  it("should get default scheduler config", () => {
    mockReadDesktopConfig.mockReturnValueOnce({});
    const config = getSchedulerConfig();
    expect(config.enabled).toBe(true);
    expect(config.tickIntervalMs).toBe(10000);
  });

  it("should save scheduler config to desktop.json", () => {
    mockReadDesktopConfig.mockReturnValueOnce({});
    setSchedulerConfig({ enabled: false, tickIntervalMs: 5000 });
    expect(mockWriteDesktopConfig).toHaveBeenCalledWith({
      schedulerEnabled: false,
      schedulerIntervalMs: 5000,
    });
  });

  it("should trigger due jobs when tickScheduler runs", async () => {
    const mockJobs = [
      {
        id: "upstream-watch-job-1",
        name: "Job 1",
        enabled: true,
        state: "idle",
        next_run_at: new Date(Date.now() - 5000).toISOString(), // 5s ago (due)
      },
      {
        id: "job-2",
        name: "Job 2",
        enabled: false, // disabled
        state: "idle",
        next_run_at: new Date(Date.now() - 5000).toISOString(),
      },
      {
        id: "job-3",
        name: "Job 3",
        enabled: true,
        state: "idle",
        next_run_at: new Date(Date.now() + 5000).toISOString(), // 5s in future (not due)
      },
    ];
    mockListCronJobs.mockResolvedValueOnce(mockJobs);

    await tickScheduler("test-profile");

    // job-1 should be triggered
    expect(mockSpawn).toHaveBeenCalled();
    await vi.waitFor(() => expect(mockLogEnd).toHaveBeenCalled());
  });

  // Regression, 2026-07-24 21:39:52: the gateway runs its own 60s cron_tick() over
  // the same jobs.json, so with the app open two processes raced for every due job
  // and app launch fired the whole overdue backlog — 18 jobs within 250ms.
  it("defers job dispatch while the engine cron ticker is alive", async () => {
    mockEngineCronTickerIsAlive.mockResolvedValue(true);
    const dueJob = {
      id: "job-due",
      name: "Due job",
      enabled: true,
      state: "idle",
      next_run_at: new Date(Date.now() - 5000).toISOString(),
    };
    mockListCronJobs.mockResolvedValue([dueJob]);

    await tickScheduler("test-profile");

    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockListCronJobs).not.toHaveBeenCalled();
  });

  // Deferring dispatch must not short-circuit the rest of the tick: the nag
  // engine, email monitor and inbox digest all run after the cron block.
  it("still runs the rest of the tick while deferring dispatch", async () => {
    mockEngineCronTickerIsAlive.mockResolvedValue(true);
    mockListCronJobs.mockResolvedValue([]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunHermesAgentUpdateRoutine).toHaveBeenCalled();
    expect(mockMaybeRunDesktopUpdateRoutine).toHaveBeenCalled();
    expect(mockRetryQueuedOwnerDeliveries).toHaveBeenCalled();
  });

  it("dispatches due jobs when the engine ticker is stale (gateway down)", async () => {
    mockEngineCronTickerIsAlive.mockResolvedValue(false);
    mockListCronJobs.mockResolvedValueOnce([
      {
        id: "job-backstop",
        name: "Backstop job",
        enabled: true,
        state: "idle",
        next_run_at: new Date(Date.now() - 5000).toISOString(),
      },
    ]);

    await tickScheduler("test-profile");

    expect(mockSpawn).toHaveBeenCalled();
    await vi.waitFor(() => expect(mockLogEnd).toHaveBeenCalled());
  });

  it("checks the managed Hermes Agent update routine on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunHermesAgentUpdateRoutine).toHaveBeenCalledWith(
      expect.any(Date),
      "test-profile",
    );
  });

  it("checks the Desktop update routine on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunDesktopUpdateRoutine).toHaveBeenCalledWith(
      expect.any(Date),
    );
  });

  it("checks upstream watch without blocking due cron jobs", async () => {
    mockMaybeRunHermesUpstreamWatchRoutine.mockImplementationOnce(
      () => new Promise(() => {}),
    );
    mockListCronJobs.mockResolvedValueOnce([
      {
        id: "job-1",
        name: "Job 1",
        enabled: true,
        state: "idle",
        next_run_at: new Date(Date.now() - 5000).toISOString(),
      },
    ]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunHermesUpstreamWatchRoutine).toHaveBeenCalledWith(
      expect.any(Date),
      "test-profile",
    );
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockLogEnd).toHaveBeenCalled());
  });

  it("checks app launch schedules on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockMaybeRunAppLaunchSchedules).toHaveBeenCalledWith(
      expect.any(Date),
      "test-profile",
    );
  });

  it("retries durable owner deliveries on scheduler ticks", async () => {
    mockListCronJobs.mockResolvedValueOnce([]);

    await tickScheduler("test-profile");

    expect(mockRetryQueuedOwnerDeliveries).toHaveBeenCalledWith("test-profile");
  });

  it.each(["remote", "ssh"] as const)(
    "does not spawn the local Hermes CLI in %s mode",
    async (mode) => {
      mockConnectionMode = mode;

      await expect(
        runJobHeadless("job-remote", "Remote job", "test-profile"),
      ).resolves.toBe(false);

      expect(mockSpawn).not.toHaveBeenCalled();
    },
  );

  it("does not write to a cron log stream after a reaped child closes", async () => {
    vi.useFakeTimers();
    mockAutoClose = false;

    const run = runJobHeadless("job-wedged", "Wedged job", "test-profile");
    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000);
    await expect(run).resolves.toBe(false);

    outputHandlers.get("stdout:data")?.("late output");
    processHandlers.get("close")?.(0);
    await Promise.resolve();

    expect(mockLogWriteAfterEnd).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("parks a transcript and treats exit-zero [SILENT] as a failed run", async () => {
    mockAutoClose = false;

    const run = runJobHeadless("job-silent", "Silent cron", "test-profile");
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    outputHandlers.get("stdout:data")?.("[SILENT]\n");
    processHandlers.get("close")?.(0);

    await expect(run).resolves.toBe(false);
    expect(mockCreateActiveWorkRun).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "cron-job",
        trigger: "cron",
        taskId: "job-silent",
        expectedArtifacts: [
          { kind: "transcript", label: "Run transcript", required: true },
        ],
      }),
      "test-profile",
    );
    expect(mockUpdateActiveWorkRun).toHaveBeenCalledWith(
      "work-cron",
      expect.objectContaining({
        artifacts: [expect.objectContaining({ kind: "transcript" })],
      }),
      "test-profile",
    );
    expect(mockUpdateActiveWorkRun).toHaveBeenCalledWith(
      "work-cron",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("[SILENT]"),
      }),
      "test-profile",
    );
  });

  it("detects a late [SILENT] result after more than 64 KiB of output", async () => {
    mockAutoClose = false;
    const run = runJobHeadless(
      "job-late-silent",
      "Late silent cron",
      "test-profile",
    );
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    outputHandlers.get("stdout:data")?.("x".repeat(70 * 1024));
    outputHandlers.get("stdout:data")?.("\n[SILENT]\n");
    processHandlers.get("close")?.(0);
    await expect(run).resolves.toBe(false);
    expect(mockUpdateActiveWorkRun).toHaveBeenCalledWith(
      "work-cron",
      expect.objectContaining({
        status: "failed",
        error: expect.stringContaining("[SILENT]"),
      }),
      "test-profile",
    );
  });

  describe("captureScreenshot", () => {
    it("should capture screen and return PNG path", async () => {
      const path = await captureScreenshot("job-123", "test-profile");
      expect(path).toContain("routine-job-123-");
      expect(path).toContain("-error.png");
    });
  });
});
