import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerDeliveryEvent } from "../shared/owner-delivery";
import type { OwnerDeliveryDependencies } from "./owner-delivery";

const state = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  home: "",
}));

vi.mock("electron", () => ({
  Notification: class {
    show(): void {
      return undefined;
    }
  },
}));

vi.mock("./config", () => ({
  readDesktopConfig: () => state.config,
  writeDesktopConfig: (next: Record<string, unknown>) => {
    state.config = structuredClone(next);
  },
}));

vi.mock("./hermes-cli-runner", () => ({
  runHermesCli: vi.fn(async () => ({ success: true })),
}));

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    profileHome: () => state.home,
  };
});

import {
  deliverOwnerEvent,
  retryQueuedOwnerDeliveries,
} from "./owner-delivery";

const EVENT: OwnerDeliveryEvent = {
  id: "follow-up:contact-1:2026-07-14",
  kind: "follow-up",
  title: "Relationship follow-up",
  body: "Call Sam",
};

function settings(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    channels: { macos: true, telegram: false, email: false },
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
    ...overrides,
  };
}

function dependencies(
  at: Date,
  notify = vi.fn(async () => true),
): OwnerDeliveryDependencies {
  return {
    notify,
    send: vi.fn(async () => true),
    now: () => at,
  };
}

describe("owner delivery durable retry queue", () => {
  beforeEach(() => {
    state.home = mkdtempSync(join(tmpdir(), "owner-delivery-queue-"));
    state.config = {
      ownerDeliveryByProfile: { default: settings() },
    };
  });

  afterEach(() => {
    rmSync(state.home, { recursive: true, force: true });
  });

  it("queues a quiet-hours skip and delivers it once after quiet hours", async () => {
    const notify = vi.fn(async () => true);
    const duringQuietHours = dependencies(
      new Date(2026, 6, 14, 23, 30),
      notify,
    );

    const initial = await deliverOwnerEvent(EVENT, undefined, duringQuietHours);
    expect(initial.delivered).toEqual([]);
    expect(initial.skipped).toContainEqual({
      channel: "macos",
      reason: "quiet-hours",
    });
    expect(notify).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        readFileSync(join(state.home, "owner-delivery-queue.json"), "utf8"),
      ),
    ).toHaveLength(1);

    const afterQuietHours = dependencies(new Date(2026, 6, 15, 7, 1), notify);
    await expect(
      retryQueuedOwnerDeliveries(undefined, afterQuietHours),
    ).resolves.toMatchObject({ delivered: ["macos"] });
    await retryQueuedOwnerDeliveries(undefined, afterQuietHours);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        readFileSync(join(state.home, "owner-delivery-queue.json"), "utf8"),
      ),
    ).toEqual([]);
  });

  it("queues a rate-limited event and retries after the interval", async () => {
    const now = new Date(2026, 6, 14, 12, 0);
    state.config = {
      ownerDeliveryByProfile: {
        default: settings({
          quietHours: { enabled: false, start: "22:00", end: "07:00" },
        }),
      },
      ownerDeliveryAttemptsByProfile: {
        default: [
          {
            eventId: "earlier",
            channel: "macos",
            deliveredAt: now.getTime() - 60_000,
          },
        ],
      },
    };
    const notify = vi.fn(async () => true);

    const initial = await deliverOwnerEvent(
      EVENT,
      undefined,
      dependencies(now, notify),
    );
    expect(initial.skipped).toContainEqual({
      channel: "macos",
      reason: "rate-limit",
    });
    expect(notify).not.toHaveBeenCalled();

    await retryQueuedOwnerDeliveries(
      undefined,
      dependencies(new Date(now.getTime() + 16 * 60_000), notify),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
