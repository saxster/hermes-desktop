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
}));

vi.mock("../src/main/gateway-chat", () => ({
  gatewayChat: mocks.gatewayChat,
  extractJson: vi.fn(),
}));
vi.mock("../src/main/rss-discovery", () => ({
  fetchRssArticles: mocks.fetchRssArticles,
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
  vi.resetModules();
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe("scheduled research failure visibility", () => {
  it("persists and pushes a gateway failure", async () => {
    const schedule = item();
    seedRegistry(schedule);
    mocks.gatewayChat.mockRejectedValueOnce(new Error("gateway offline"));
    const send = vi.fn();
    const { runScheduledResearch } =
      await import("../src/main/scheduled-research");

    const result = await runScheduledResearch(
      schedule,
      () => ({ webContents: { send } }) as never,
      "default",
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
});
