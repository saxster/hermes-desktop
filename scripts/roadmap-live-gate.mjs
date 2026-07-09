#!/usr/bin/env node
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluateOwnerChannelReadiness } from "./owner-channel-readiness.mjs";
import { runOwnerChannelLiveSmoke } from "./owner-channel-live-smoke.mjs";
import { runMobileTaskLiveSmoke } from "./mobile-task-live-smoke.mjs";

function parseArgs(argv) {
  const opts = {
    home: process.env.HERMES_HOME || join(homedir(), ".hermes"),
    profile: "",
    live: false,
    url: process.env.HERMES_OWNER_CHANNEL_GATEWAY_URL || "",
    apiKey: process.env.HERMES_OWNER_CHANNEL_API_KEY || "",
    port: Number(process.env.HERMES_MOBILE_TASK_CONTROL_PORT || 0),
    token: process.env.HERMES_MOBILE_TASK_TOKEN || "",
    chatId: process.env.HERMES_MOBILE_TASK_CHAT_ID || "",
    ownerMessage: "",
    taskText: "",
    timeoutMs: 30_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--home") {
      opts.home = argv[++i] || opts.home;
    } else if (arg === "--profile") {
      opts.profile = argv[++i] || "";
    } else if (arg === "--live") {
      opts.live = true;
    } else if (arg === "--url") {
      opts.url = argv[++i] || "";
    } else if (arg === "--api-key") {
      opts.apiKey = argv[++i] || "";
    } else if (arg === "--port") {
      opts.port = Number(argv[++i] || 0);
    } else if (arg === "--token") {
      opts.token = argv[++i] || "";
    } else if (arg === "--chat-id") {
      opts.chatId = argv[++i] || "";
    } else if (arg === "--owner-message") {
      opts.ownerMessage = argv[++i] || "";
    } else if (arg === "--task-text") {
      opts.taskText = argv[++i] || "";
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(argv[++i] || opts.timeoutMs);
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  opts.home = resolve(opts.home);
  opts.apiKey = String(opts.apiKey || "").trim();
  opts.token = String(opts.token || "").trim();
  opts.chatId = String(opts.chatId || "").trim();
  opts.ownerMessage = String(opts.ownerMessage || "").trim();
  opts.taskText = String(opts.taskText || "").trim();
  opts.timeoutMs =
    Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? Math.floor(opts.timeoutMs)
      : 30_000;
  return opts;
}

function compactReadiness(readiness) {
  return {
    status: readiness.status,
    profile: readiness.profile,
    telegramLiveReady: readiness.telegramLiveReady,
    enabledChannels: readiness.enabledChannels,
    readyChannels: readiness.readyChannels,
    ownerPrefsEntryExists: readiness.ownerPrefsEntryExists,
    channelDirectoryTelegramTargets: readiness.channelDirectoryTelegramTargets,
    blockingReasons: readiness.blockingReasons,
  };
}

function compactOwnerChannelLive(result) {
  return {
    status: result.status,
    reason: result.reason,
    profile: result.profile,
    gatewayUrl: result.gatewayUrl,
    hasApiKey: result.hasApiKey,
    telegramLiveReady: result.telegramLiveReady,
    messageLength: result.messageLength,
    requiredEnv: result.requiredEnv,
  };
}

function compactMobileTask(result) {
  return {
    status: result.status,
    reason: result.reason,
    profile: result.profile,
    controlPort: result.controlPort,
    controlServerProfile: result.controlServerProfile,
    gatewayRunning: result.gatewayRunning,
    hasChatId: result.hasChatId,
    textLength: result.textLength,
    requiredEnv: result.requiredEnv,
    rowId: result.rowId,
    verified: result.verified,
    hasPort: result.hasPort,
    hasToken: result.hasToken,
  };
}

function gateReason(prefix, result) {
  if (result.status !== "blocked" && result.status !== "failed") return [];
  return [`${prefix}:${result.reason || result.status}`];
}

function readinessReasons(readiness) {
  if (readiness.status === "ready" && readiness.telegramLiveReady === true) {
    return [];
  }
  const reasons = Array.isArray(readiness.blockingReasons)
    ? readiness.blockingReasons
    : [];
  const out = reasons.map((reason) => `owner-channel-readiness:${reason}`);
  if (readiness.telegramLiveReady !== true) {
    out.push("owner-channel-readiness:telegram-not-ready");
  }
  return [...new Set(out)];
}

function aggregateStatus(mode, ownerLive, mobileTask, blockingReasons) {
  if (ownerLive.status === "failed" || mobileTask.status === "failed") {
    return "failed";
  }
  if (blockingReasons.length > 0) return "blocked";
  if (mode === "live") return "passed";
  return "ready";
}

async function runRoadmapLiveGate(options = {}) {
  const opts = {
    home: resolve(options.home || join(homedir(), ".hermes")),
    profile: options.profile || "",
    live: options.live === true,
    url: options.url || "",
    apiKey: options.apiKey || "",
    port: Number(options.port || 0),
    token: options.token || "",
    chatId: options.chatId || "",
    ownerMessage: options.ownerMessage || "",
    taskText: options.taskText || "",
    timeoutMs:
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : 30_000,
  };
  const readiness = evaluateOwnerChannelReadiness({
    home: opts.home,
    profile: opts.profile,
  });
  const ownerChannelLive = await runOwnerChannelLiveSmoke({
    home: opts.home,
    profile: opts.profile,
    url: opts.url,
    apiKey: opts.apiKey,
    message: opts.ownerMessage,
    send: opts.live,
    timeoutMs: opts.timeoutMs,
  }).catch((err) => ({
    status: "failed",
    reason: "owner-channel-live-error",
    error: err instanceof Error ? err.message : String(err),
  }));
  const mobileTask = await runMobileTaskLiveSmoke({
    home: opts.home,
    profile: opts.profile,
    port: opts.port,
    token: opts.token,
    chatId: opts.chatId,
    text: opts.taskText,
    write: opts.live,
    timeoutMs: opts.timeoutMs,
  }).catch((err) => ({
    status: "failed",
    reason: "mobile-task-error",
    error: err instanceof Error ? err.message : String(err),
  }));
  const blockingReasons = [
    ...readinessReasons(readiness),
    ...gateReason("owner-channel-live", ownerChannelLive),
    ...gateReason("mobile-task", mobileTask),
  ];
  const mode = opts.live ? "live" : "dry-run";
  return {
    status: aggregateStatus(
      mode,
      ownerChannelLive,
      mobileTask,
      blockingReasons,
    ),
    mode,
    hermesHome: opts.home,
    profile: readiness.profile,
    liveActions: {
      ownerChannel: opts.live ? "send" : "dry-run",
      mobileTask: opts.live ? "write" : "dry-run",
    },
    gates: {
      ownerChannelReadiness: compactReadiness(readiness),
      ownerChannelLive: compactOwnerChannelLive(ownerChannelLive),
      mobileTask: compactMobileTask(mobileTask),
    },
    blockingReasons,
    nextActions:
      blockingReasons.length === 0
        ? []
        : [
            "Configure Telegram owner prefs and the gateway Telegram target.",
            "Start the desktop control server for the active owner profile.",
            "Run dry-run mode first; use --live only with the existing HERMES_OWNER_CHANNEL_LIVE=1 and HERMES_MOBILE_TASK_LIVE=1 guards.",
          ],
  };
}

function printHelp() {
  console.log(`Usage: node scripts/roadmap-live-gate.mjs [--home <path>] [--profile <name>] [--live]

Aggregates the final owner live gates for the roadmap:
  1. Telegram owner-channel readiness.
  2. Outbound owner-channel Telegram smoke.
  3. Inbound /sps/mobile-task smoke.

Default mode is read-only/dry-run. --live passes --send/--write through to the
existing smoke harnesses, which still require HERMES_OWNER_CHANNEL_LIVE=1 and
HERMES_MOBILE_TASK_LIVE=1 before sending or writing.

Options:
  --home <path>           HERMES_HOME to inspect (default: $HERMES_HOME or ~/.hermes)
  --profile <name>        Profile key to inspect (default: active_profile or default)
  --live                  Attempt the explicit live send/write gates
  --url <base>            Gateway base URL override for owner-channel smoke
  --api-key <key>         Gateway API key override for owner-channel smoke
  --port <port>           Control-server port override for mobile-task smoke
  --token <token>         Control-server token override for mobile-task smoke
  --chat-id <id>          Telegram chat id override for mobile-task smoke
  --owner-message <text>  Outbound owner-channel smoke message
  --task-text <text>      Inbound mobile-task smoke text
  --timeout-ms <ms>       Per-request timeout
`);
}

export { runRoadmapLiveGate };

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
    const result = await runRoadmapLiveGate(opts);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "blocked") process.exit(2);
    if (result.status === "failed") process.exit(4);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
