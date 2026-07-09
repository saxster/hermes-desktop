#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER_CHANNELS = ["macos", "telegram", "email", "whatsapp"];
const OWNER_EVENTS = ["brief", "nag", "alert", "update"];

const DEFAULT_PREFS = {
  channels: {
    macos: true,
    telegram: false,
    email: false,
    whatsapp: false,
  },
  events: {
    brief: true,
    nag: true,
    alert: true,
    update: true,
  },
  targets: {
    telegramChatId: "",
    emailAddress: "",
    whatsappTarget: "",
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
  },
  rateLimitMinutes: 10,
};

function parseArgs(argv) {
  const opts = {
    home: process.env.HERMES_HOME || join(homedir(), ".hermes"),
    profile: "",
    requireReady: false,
    requireTelegram: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--home") {
      opts.home = argv[++i] || opts.home;
    } else if (arg === "--profile") {
      opts.profile = argv[++i] || "";
    } else if (arg === "--require-ready") {
      opts.requireReady = true;
    } else if (arg === "--require-telegram") {
      opts.requireTelegram = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  opts.home = resolve(opts.home);
  return opts;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function readActiveProfile(home) {
  try {
    const profile = readFileSync(join(home, "active_profile"), "utf-8").trim();
    return profile || "default";
  } catch {
    return "default";
  }
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function boolMap(raw, defaults, keys) {
  const data = objectValue(raw);
  const out = { ...defaults };
  for (const key of keys) {
    if (typeof data[key] === "boolean") out[key] = data[key];
  }
  return out;
}

function timeValue(value, fallback) {
  const raw = stringValue(value);
  return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
}

function intervalMinutes(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function normalizePrefs(rawPrefs) {
  const data = objectValue(rawPrefs);
  const targets = objectValue(data.targets);
  const quietHours = objectValue(data.quietHours);
  return {
    channels: boolMap(data.channels, DEFAULT_PREFS.channels, OWNER_CHANNELS),
    events: boolMap(data.events, DEFAULT_PREFS.events, OWNER_EVENTS),
    targets: {
      telegramChatId: stringValue(targets.telegramChatId),
      emailAddress: stringValue(targets.emailAddress),
      whatsappTarget: stringValue(targets.whatsappTarget),
    },
    quietHours: {
      enabled: quietHours.enabled === true,
      start: timeValue(quietHours.start, DEFAULT_PREFS.quietHours.start),
      end: timeValue(quietHours.end, DEFAULT_PREFS.quietHours.end),
    },
    rateLimitMinutes:
      data.rateLimitMinutes === undefined
        ? DEFAULT_PREFS.rateLimitMinutes
        : intervalMinutes(data.rateLimitMinutes),
  };
}

function channelDirectoryTelegramTargets(rawDirectory) {
  const channels = Array.isArray(rawDirectory.channels)
    ? rawDirectory.channels
    : [];
  return channels.filter((channel) =>
    stringValue(objectValue(channel).target).startsWith("telegram:"),
  ).length;
}

function channelStatus(channel, prefs, gatewayTelegramTargets) {
  const enabled = prefs.channels[channel] === true;
  if (channel === "macos") {
    return {
      enabled,
      configured: enabled,
      ready: enabled,
      reason: enabled ? "available" : "disabled",
    };
  }
  if (channel === "telegram") {
    const hasOwnerTarget = Boolean(prefs.targets.telegramChatId);
    const hasGatewayTarget = gatewayTelegramTargets > 0;
    return {
      enabled,
      configured: hasOwnerTarget && hasGatewayTarget,
      ready: enabled && hasOwnerTarget && hasGatewayTarget,
      reason: !enabled
        ? "disabled"
        : !hasOwnerTarget
          ? "missing-owner-telegram-target"
          : !hasGatewayTarget
            ? "missing-gateway-telegram-channel"
            : "available",
      hasOwnerTarget,
      gatewayTelegramTargets,
    };
  }
  if (channel === "email") {
    const hasOwnerTarget = Boolean(prefs.targets.emailAddress);
    return {
      enabled,
      configured: hasOwnerTarget,
      ready: enabled && hasOwnerTarget,
      reason: !enabled
        ? "disabled"
        : hasOwnerTarget
          ? "available"
          : "missing-owner-email-target",
      hasOwnerTarget,
    };
  }
  const hasOwnerTarget = Boolean(prefs.targets.whatsappTarget);
  return {
    enabled,
    configured: hasOwnerTarget,
    ready: false,
    reason: !enabled
      ? "disabled"
      : hasOwnerTarget
        ? "whatsapp-sender-not-implemented"
        : "missing-owner-whatsapp-target",
    hasOwnerTarget,
  };
}

export function evaluateOwnerChannelReadiness(options = {}) {
  const home = resolve(
    options.home || process.env.HERMES_HOME || join(homedir(), ".hermes"),
  );
  const desktopPath = join(home, "desktop.json");
  const channelDirectoryPath = join(home, "channel_directory.json");
  const desktopConfig = readJson(desktopPath);
  const profile = options.profile || readActiveProfile(home);
  const prefsByProfile = objectValue(
    desktopConfig.ownerNotificationPrefsByProfile,
  );
  const storedPrefs = prefsByProfile[profile];
  const prefs = normalizePrefs(storedPrefs);
  const channelDirectory = readJson(channelDirectoryPath);
  const gatewayTelegramTargets =
    channelDirectoryTelegramTargets(channelDirectory);
  const channels = Object.fromEntries(
    OWNER_CHANNELS.map((channel) => [
      channel,
      channelStatus(channel, prefs, gatewayTelegramTargets),
    ]),
  );
  const enabledChannels = OWNER_CHANNELS.filter(
    (channel) => channels[channel].enabled,
  );
  const readyChannels = OWNER_CHANNELS.filter(
    (channel) => channels[channel].ready,
  );
  const blockingReasons = [];
  if (!existsSync(desktopPath)) {
    blockingReasons.push("missing-desktop-config");
  }
  if (!storedPrefs) {
    blockingReasons.push("missing-owner-notification-prefs");
  }
  for (const channel of enabledChannels) {
    if (!channels[channel].ready) {
      blockingReasons.push(`${channel}:${channels[channel].reason}`);
    }
  }
  if (enabledChannels.length === 0) {
    blockingReasons.push("no-enabled-owner-channels");
  }
  const telegramLiveReady = channels.telegram.ready;
  const status =
    blockingReasons.length === 0 && readyChannels.length > 0
      ? "ready"
      : "blocked";
  return {
    status,
    profile,
    hermesHome: home,
    desktopConfigExists: existsSync(desktopPath),
    ownerPrefsEntryExists: Boolean(storedPrefs),
    enabledChannels,
    readyChannels,
    telegramLiveReady,
    channelDirectoryExists: existsSync(channelDirectoryPath),
    channelDirectoryTelegramTargets: gatewayTelegramTargets,
    channels,
    blockingReasons,
    nextActions:
      status === "ready"
        ? [
            "Run a live owner delivery smoke from the app or a dedicated sender harness.",
          ]
        : [
            "Save owner notification preferences for this profile.",
            "Enable and target Telegram for the owner if Telegram live proof is required.",
            "Configure the Hermes gateway Telegram channel before live Telegram smoke.",
          ],
  };
}

function printHelp() {
  console.log(`Usage: node scripts/owner-channel-readiness.mjs [--home <path>] [--profile <name>] [--require-ready] [--require-telegram]

Read-only owner-channel readiness check. It prints redacted JSON and never sends live messages.

Options:
  --home <path>          HERMES_HOME to inspect (default: $HERMES_HOME or ~/.hermes)
  --profile <name>      Profile key to inspect (default: active_profile or default)
  --require-ready       Exit 2 when readiness status is not "ready"
  --require-telegram    Exit 2 when Telegram live readiness is false
`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      printHelp();
      process.exit(0);
    }
    const result = evaluateOwnerChannelReadiness(opts);
    console.log(JSON.stringify(result, null, 2));
    if (opts.requireReady && result.status !== "ready") process.exit(2);
    if (opts.requireTelegram && result.telegramLiveReady !== true) {
      process.exit(2);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
