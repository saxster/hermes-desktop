import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  normalizeMonitorSourcePlan,
  type ScheduledResearchItem,
} from "../src/shared/scheduledResearch";

const mocks = vi.hoisted(() => ({
  gatewayChat: vi.fn(),
  fetchRssArticles: vi.fn(),
  createCronJob: vi.fn(),
  listCronJobs: vi.fn(),
  removeCronJob: vi.fn(),
  pauseCronJob: vi.fn(),
  resumeCronJob: vi.fn(),
  cronName: "",
}));

vi.mock("../src/main/gateway-chat", () => ({
  gatewayChat: mocks.gatewayChat,
  extractJson: vi.fn(),
}));
vi.mock("../src/main/rss-discovery", () => ({
  fetchRssArticles: mocks.fetchRssArticles,
}));
vi.mock("../src/main/cronjobs", () => ({
  createCronJob: (...args: unknown[]) => {
    mocks.cronName = String(args[2] || "");
    return mocks.createCronJob(...args);
  },
  listCronJobs: (...args: unknown[]) => mocks.listCronJobs(...args),
  removeCronJob: (...args: unknown[]) => mocks.removeCronJob(...args),
  pauseCronJob: (...args: unknown[]) => mocks.pauseCronJob(...args),
  resumeCronJob: (...args: unknown[]) => mocks.resumeCronJob(...args),
}));

let home: string;
let originalHome: string | undefined;

function registryPath(): string {
  return join(home, "sps-agent", "scheduled-research.json");
}

function item(
  overrides: Partial<ScheduledResearchItem> = {},
): ScheduledResearchItem {
  return {
    id: "sr_failure",
    topic: "Agent reliability",
    pageId: "agent-reliability",
    cadence: "daily",
    hour: 8,
    autoApply: false,
    enabled: true,
    createdAt: 1,
    lastRunAt: 0,
    lastChangeHash: "",
    ...overrides,
  };
}

function seedRegistry(schedule: ScheduledResearchItem): void {
  mkdirSync(join(home, "sps-agent"), { recursive: true });
  writeFileSync(
    registryPath(),
    JSON.stringify({ schedules: [schedule] }),
    "utf-8",
  );
}

function readStored(): ScheduledResearchItem {
  return JSON.parse(readFileSync(registryPath(), "utf-8")).schedules[0];
}

beforeEach(() => {
  originalHome = process.env.HERMES_HOME;
  home = mkdtempSync(join(tmpdir(), "scheduled-research-failure-"));
  process.env.HERMES_HOME = home;
  mocks.gatewayChat.mockReset();
  mocks.fetchRssArticles.mockReset();
  mocks.createCronJob.mockReset();
  mocks.listCronJobs.mockReset();
  mocks.removeCronJob.mockReset();
  mocks.pauseCronJob.mockReset();
  mocks.resumeCronJob.mockReset();
  mocks.createCronJob.mockResolvedValue({ success: true });
  mocks.listCronJobs.mockImplementation(async () => [
    { id: "cron-1", name: mocks.cronName },
  ]);
  mocks.removeCronJob.mockResolvedValue({ success: true });
  mocks.pauseCronJob.mockResolvedValue({ success: true });
  mocks.resumeCronJob.mockResolvedValue({ success: true });
  vi.resetModules();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe("scheduled research failure visibility", () => {
  it("does not claim a research schedule exists when its paired cron fails", async () => {
    mocks.createCronJob.mockResolvedValueOnce({
      success: false,
      error: "cron service offline",
    });
    const { createSchedule, listSchedules } =
      await import("../src/main/scheduled-research");
    expect(
      await createSchedule(
        {
          topic: "Agent reliability",
          cadence: "daily",
          hour: 8,
          autoApply: false,
        },
        "default",
      ),
    ).toEqual({ ok: false, error: "cron service offline" });
    expect(listSchedules("default")).toEqual([]);
  });

  it("keeps a schedule when its paired cron cannot be removed", async () => {
    const { createSchedule, deleteSchedule, listSchedules } =
      await import("../src/main/scheduled-research");
    const created = await createSchedule(
      {
        topic: "Agent reliability",
        cadence: "daily",
        hour: 8,
        autoApply: false,
      },
      "default",
    );
    mocks.removeCronJob.mockResolvedValueOnce({
      success: false,
      error: "cron service offline",
    });
    expect(await deleteSchedule(created.item!.id, "default")).toEqual({
      ok: false,
      error: "cron service offline",
    });
    expect(listSchedules("default")).toHaveLength(1);
  });

  it("persists and pushes a gateway failure", async () => {
    const schedule = item();
    seedRegistry(schedule);
    mocks.gatewayChat.mockRejectedValueOnce(new Error("gateway offline"));
    const send = vi.fn();
    const { runSchedule } = await import("../src/main/scheduled-research");

    const result = await runSchedule(
      schedule,
      () => ({ webContents: { send } }) as never,
      "default",
      "manual",
    );

    expect(result).toMatchObject({
      outcome: "error",
      error: "gateway offline",
    });
    expect(readStored()).toMatchObject({ lastError: "gateway offline" });
    expect(send).toHaveBeenCalledWith(
      "scheduled-research-update",
      expect.objectContaining({ outcome: "error", error: "gateway offline" }),
    );
    const { listActiveWorkRuns } = await import("../src/main/active-work-runs");
    const { listHumanAttentionItems } =
      await import("../src/main/human-attention");
    const active = await listActiveWorkRuns("default");
    expect(active[0]).toMatchObject({
      source: "scheduled-research",
      trigger: "manual",
      status: "failed",
      error: "gateway offline",
    });
    expect(active[0].artifacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "transcript" })]),
    );
    expect(await listHumanAttentionItems({}, "default")).toEqual([
      expect.objectContaining({ kind: "failed-run", runId: active[0].id }),
    ]);
  });

  it("does not advance a failed feed's lastCheckedAt", async () => {
    const sourcePlan = normalizeMonitorSourcePlan([
      {
        kind: "rss",
        label: "Status feed",
        url: "https://example.com/feed",
        status: "approved",
        lastCheckedAt: 10,
      },
    ]);
    const schedule = item({ sourcePlan });
    seedRegistry(schedule);
    mocks.fetchRssArticles.mockRejectedValueOnce(new Error("HTTP 503"));
    mocks.gatewayChat.mockResolvedValueOnce("No cited sources were available.");
    const { runScheduledResearch } =
      await import("../src/main/scheduled-research");

    await runScheduledResearch(schedule, undefined, "default");

    expect(readStored().sourcePlan?.[0]).toMatchObject({
      lastCheckedAt: 10,
      lastError: "HTTP 503",
    });
  });

  it("rejects app-closed cron briefs that have no fetched sources", async () => {
    const schedule = item({ cronJobId: "cron_without_sources" });
    seedRegistry(schedule);
    const outputDir = join(home, "cron", "output", "cron_without_sources");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(outputDir, "brief.md"),
      "# Cron Job\n## Response\nA confident answer with no source section.",
      "utf-8",
    );
    const { drainCronBriefs, listPending } =
      await import("../src/main/scheduled-research");

    await drainCronBriefs(undefined, "default");

    expect(await listPending("default")).toEqual([]);
    expect(mocks.gatewayChat).not.toHaveBeenCalled();
    expect(readStored()).toMatchObject({
      lastError: "No web sources returned.",
      lastDrainedAt: expect.any(Number),
    });
    const { listActiveWorkRuns } = await import("../src/main/active-work-runs");
    expect(await listActiveWorkRuns("default")).toEqual([
      expect.objectContaining({ status: "failed", trigger: "cron" }),
    ]);
  });

  it("surfaces a missing-skill [SILENT] cron instead of recording success", async () => {
    const schedule = item({ cronJobId: "cron_missing_skill" });
    seedRegistry(schedule);
    const outputDir = join(home, "cron", "output", "cron_missing_skill");
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(outputDir, "brief.md"),
      '# Cron Job\n## Response\n⚠️ Skill "daily-brief" not found\n[SILENT]\n',
      "utf-8",
    );
    const { drainCronBriefs } = await import("../src/main/scheduled-research");

    await drainCronBriefs(undefined, "default");

    expect(readStored()).toMatchObject({
      lastError: expect.stringContaining("Skill"),
      lastDrainedAt: expect.any(Number),
    });
    const { listActiveWorkRuns } = await import("../src/main/active-work-runs");
    const { listHumanAttentionItems } =
      await import("../src/main/human-attention");
    const active = await listActiveWorkRuns("default");
    expect(active[0]).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Skill"),
    });
    expect(await listHumanAttentionItems({}, "default")).toEqual([
      expect.objectContaining({ kind: "failed-run", runId: active[0].id }),
    ]);
  });
});
