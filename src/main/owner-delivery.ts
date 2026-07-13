import { Notification } from "electron";
import type {
  OwnerDeliveryAttempt,
  OwnerDeliveryChannel,
  OwnerDeliveryEvent,
  OwnerDeliveryResult,
  OwnerDeliverySettings,
} from "../shared/owner-delivery";
import { readDesktopConfig, writeDesktopConfig } from "./config";
import { runHermesCli } from "./hermes-cli-runner";
import { log } from "./log";
import { normalizeProfileName } from "./utils";

const SETTINGS_KEY = "ownerDeliveryByProfile";
const ATTEMPTS_KEY = "ownerDeliveryAttemptsByProfile";
const CHANNELS: OwnerDeliveryChannel[] = ["macos", "telegram", "email"];
const MAX_ATTEMPT_HISTORY = 500;

export const DEFAULT_OWNER_DELIVERY_SETTINGS: OwnerDeliverySettings = {
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
};

interface OwnerDeliveryDependencies {
  notify: (title: string, body: string) => Promise<boolean>;
  send: (
    channel: Exclude<OwnerDeliveryChannel, "macos">,
    event: OwnerDeliveryEvent,
    profile?: string,
  ) => Promise<boolean>;
  now: () => Date;
}

function profileKey(profile?: string): string {
  return normalizeProfileName(profile) || "default";
}

function recordMap<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, T>)
    : {};
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function validTime(value: unknown, fallback: string): string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? value
    : fallback;
}

export function normalizeOwnerDeliverySettings(
  value: Partial<OwnerDeliverySettings> | null | undefined,
): OwnerDeliverySettings {
  return {
    channels: {
      ...DEFAULT_OWNER_DELIVERY_SETTINGS.channels,
      ...(value?.channels || {}),
    },
    events: {
      ...DEFAULT_OWNER_DELIVERY_SETTINGS.events,
      ...(value?.events || {}),
    },
    quietHours: {
      enabled:
        typeof value?.quietHours?.enabled === "boolean"
          ? value.quietHours.enabled
          : DEFAULT_OWNER_DELIVERY_SETTINGS.quietHours.enabled,
      start: validTime(
        value?.quietHours?.start,
        DEFAULT_OWNER_DELIVERY_SETTINGS.quietHours.start,
      ),
      end: validTime(
        value?.quietHours?.end,
        DEFAULT_OWNER_DELIVERY_SETTINGS.quietHours.end,
      ),
    },
    minIntervalMinutes: clampInteger(
      value?.minIntervalMinutes,
      DEFAULT_OWNER_DELIVERY_SETTINGS.minIntervalMinutes,
      0,
      1_440,
    ),
    maxPerHour: clampInteger(
      value?.maxPerHour,
      DEFAULT_OWNER_DELIVERY_SETTINGS.maxPerHour,
      1,
      100,
    ),
  };
}

export function getOwnerDeliverySettings(
  profile?: string,
): OwnerDeliverySettings {
  const config = readDesktopConfig();
  const map = recordMap<Partial<OwnerDeliverySettings>>(config[SETTINGS_KEY]);
  return normalizeOwnerDeliverySettings(map[profileKey(profile)]);
}

export function setOwnerDeliverySettings(
  update: Partial<OwnerDeliverySettings>,
  profile?: string,
): OwnerDeliverySettings {
  const config = readDesktopConfig();
  const map = recordMap<Partial<OwnerDeliverySettings>>(config[SETTINGS_KEY]);
  const current = getOwnerDeliverySettings(profile);
  const next = normalizeOwnerDeliverySettings({
    ...current,
    ...update,
    channels: { ...current.channels, ...(update.channels || {}) },
    events: { ...current.events, ...(update.events || {}) },
    quietHours: { ...current.quietHours, ...(update.quietHours || {}) },
  });
  map[profileKey(profile)] = next;
  config[SETTINGS_KEY] = map;
  writeDesktopConfig(config);
  return next;
}

export function ownerDeliveryQuietHoursActive(
  settings: OwnerDeliverySettings,
  now: Date,
): boolean {
  if (!settings.quietHours.enabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (value: string): number => {
    const [hours, mins] = value.split(":").map(Number);
    return hours * 60 + mins;
  };
  const start = toMinutes(settings.quietHours.start);
  const end = toMinutes(settings.quietHours.end);
  if (start === end) return true;
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

function attemptsForProfile(profile?: string): OwnerDeliveryAttempt[] {
  const config = readDesktopConfig();
  const map = recordMap<OwnerDeliveryAttempt[]>(config[ATTEMPTS_KEY]);
  return Array.isArray(map[profileKey(profile)])
    ? map[profileKey(profile)].filter(
        (attempt) =>
          attempt &&
          typeof attempt.eventId === "string" &&
          CHANNELS.includes(attempt.channel) &&
          typeof attempt.deliveredAt === "number",
      )
    : [];
}

function saveAttempts(
  attempts: OwnerDeliveryAttempt[],
  profile?: string,
): void {
  const config = readDesktopConfig();
  const map = recordMap<OwnerDeliveryAttempt[]>(config[ATTEMPTS_KEY]);
  map[profileKey(profile)] = attempts.slice(-MAX_ATTEMPT_HISTORY);
  config[ATTEMPTS_KEY] = map;
  writeDesktopConfig(config);
}

export function ownerDeliverySkipReason(
  channel: OwnerDeliveryChannel,
  event: OwnerDeliveryEvent,
  settings: OwnerDeliverySettings,
  attempts: OwnerDeliveryAttempt[],
  now: Date,
): OwnerDeliveryResult["skipped"][number]["reason"] | null {
  if (!settings.channels[channel]) return "disabled";
  if (!settings.events[event.kind]) return "event-disabled";
  if (ownerDeliveryQuietHoursActive(settings, now)) return "quiet-hours";
  if (
    attempts.some(
      (attempt) => attempt.eventId === event.id && attempt.channel === channel,
    )
  ) {
    return "duplicate";
  }
  const nowMs = now.getTime();
  const channelAttempts = attempts.filter(
    (attempt) => attempt.channel === channel,
  );
  const latest = channelAttempts.reduce(
    (max, attempt) => Math.max(max, attempt.deliveredAt),
    0,
  );
  if (nowMs - latest < settings.minIntervalMinutes * 60_000) {
    return "rate-limit";
  }
  if (
    channelAttempts.filter((attempt) => nowMs - attempt.deliveredAt < 3_600_000)
      .length >= settings.maxPerHour
  ) {
    return "rate-limit";
  }
  return null;
}

const defaultDependencies: OwnerDeliveryDependencies = {
  notify: async (title, body) => {
    try {
      new Notification({ title, body }).show();
      return true;
    } catch {
      return false;
    }
  },
  send: async (channel, event, profile) => {
    const result = await runHermesCli(
      [
        "send",
        "--to",
        channel,
        "--subject",
        event.title,
        "--quiet",
        event.body,
      ],
      { profile, timeoutMs: 30_000 },
    );
    return result.success;
  },
  now: () => new Date(),
};

export async function deliverOwnerEvent(
  event: OwnerDeliveryEvent,
  profile?: string,
  dependencies: OwnerDeliveryDependencies = defaultDependencies,
): Promise<OwnerDeliveryResult> {
  const settings = getOwnerDeliverySettings(profile);
  const attempts = attemptsForProfile(profile);
  const now = dependencies.now();
  const result: OwnerDeliveryResult = { delivered: [], skipped: [] };

  for (const channel of CHANNELS) {
    const reason = ownerDeliverySkipReason(
      channel,
      event,
      settings,
      attempts,
      now,
    );
    if (reason) {
      result.skipped.push({ channel, reason });
      continue;
    }
    const delivered =
      channel === "macos"
        ? await dependencies.notify(event.title, event.body)
        : await dependencies.send(channel, event, profile);
    if (!delivered) {
      result.skipped.push({ channel, reason: "failed" });
      log.warn("owner-delivery", {
        msg: "owner delivery failed",
        eventId: event.id,
        kind: event.kind,
        channel,
      });
      continue;
    }
    attempts.push({
      eventId: event.id,
      channel,
      deliveredAt: now.getTime(),
    });
    result.delivered.push(channel);
  }

  if (result.delivered.length > 0) saveAttempts(attempts, profile);
  return result;
}
