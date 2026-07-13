import { describe, expect, it } from "vitest";
import type {
  OwnerDeliveryAttempt,
  OwnerDeliveryEvent,
} from "../shared/owner-delivery";
import {
  DEFAULT_OWNER_DELIVERY_SETTINGS,
  normalizeOwnerDeliverySettings,
  ownerDeliverySkipReason,
} from "./owner-delivery";

const EVENT: OwnerDeliveryEvent = {
  id: "brief:2026-07-13",
  kind: "daily-brief",
  title: "Daily brief",
  body: "Three items need attention.",
};

describe("owner delivery policy", () => {
  it("normalizes malformed limits and clock values", () => {
    expect(
      normalizeOwnerDeliverySettings({
        quietHours: { enabled: true, start: "99:00", end: "06:30" },
        minIntervalMinutes: -5,
        maxPerHour: 1_000,
      }),
    ).toMatchObject({
      quietHours: { enabled: true, start: "22:00", end: "06:30" },
      minIntervalMinutes: 0,
      maxPerHour: 100,
    });
  });

  it("applies quiet hours across midnight", () => {
    const settings = {
      ...DEFAULT_OWNER_DELIVERY_SETTINGS,
      channels: { macos: true, telegram: true, email: true },
    };

    expect(
      ownerDeliverySkipReason(
        "telegram",
        EVENT,
        settings,
        [],
        new Date(2026, 6, 13, 23, 0),
      ),
    ).toBe("quiet-hours");
    expect(
      ownerDeliverySkipReason(
        "telegram",
        EVENT,
        settings,
        [],
        new Date(2026, 6, 13, 12, 0),
      ),
    ).toBeNull();
  });

  it("deduplicates event-channel pairs and enforces both rate limits", () => {
    const settings = {
      ...DEFAULT_OWNER_DELIVERY_SETTINGS,
      channels: { macos: true, telegram: true, email: true },
      quietHours: { enabled: false, start: "22:00", end: "07:00" },
      minIntervalMinutes: 15,
      maxPerHour: 2,
    };
    const now = new Date(2026, 6, 13, 12, 0);
    const attempts: OwnerDeliveryAttempt[] = [
      {
        eventId: EVENT.id,
        channel: "macos",
        deliveredAt: now.getTime() - 60_000,
      },
      {
        eventId: "other",
        channel: "telegram",
        deliveredAt: now.getTime() - 60_000,
      },
      {
        eventId: "older",
        channel: "email",
        deliveredAt: now.getTime() - 50 * 60_000,
      },
      {
        eventId: "newer",
        channel: "email",
        deliveredAt: now.getTime() - 20 * 60_000,
      },
    ];

    expect(
      ownerDeliverySkipReason("macos", EVENT, settings, attempts, now),
    ).toBe("duplicate");
    expect(
      ownerDeliverySkipReason("telegram", EVENT, settings, attempts, now),
    ).toBe("rate-limit");
    expect(
      ownerDeliverySkipReason("email", EVENT, settings, attempts, now),
    ).toBe("rate-limit");
  });
});
