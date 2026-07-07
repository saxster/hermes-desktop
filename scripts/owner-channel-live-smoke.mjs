#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { evaluateOwnerChannelReadiness } from "./owner-channel-readiness.mjs";

const DEFAULT_LOCAL_PORT = 8642;
const LIVE_ENV = "HERMES_OWNER_CHANNEL_LIVE";

function parseArgs(argv) {
  const opts = {
    home: process.env.HERMES_HOME || join(homedir(), ".hermes"),
    profile: "",
    url: process.env.HERMES_OWNER_CHANNEL_GATEWAY_URL || "",
    apiKey: process.env.HERMES_OWNER_CHANNEL_API_KEY || "",
    message: "",
    send: false,
    timeoutMs: 60_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--home") {
      opts.home = argv[++i] || opts.home;
    } else if (arg === "--profile") {
      opts.profile = argv[++i] || "";
    } else if (arg === "--url") {
      opts.url = argv[++i] || "";
    } else if (arg === "--api-key") {
      opts.apiKey = argv[++i] || "";
    } else if (arg === "--message") {
      opts.message = argv[++i] || "";
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(argv[++i] || opts.timeoutMs);
    } else if (arg === "--send") {
      opts.send = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  opts.home = resolve(opts.home);
  opts.url = normalizeUrl(opts.url);
  opts.apiKey = opts.apiKey.trim();
  opts.message =
    opts.message.trim() ||
    `Hermes owner-channel live smoke ${new Date().toISOString()}`;
  opts.timeoutMs =
    Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? Math.floor(opts.timeoutMs)
      : 60_000;
  return opts;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
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

function readActiveProfile(home) {
  try {
    const profile = readFileSync(join(home, "active_profile"), "utf-8").trim();
    return profile || "default";
  } catch {
    return "default";
  }
}

function profileHome(home, profile) {
  return profile && profile !== "default"
    ? join(home, "profiles", profile)
    : home;
}

function normalizeUrl(raw) {
  return stringValue(raw).replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function readYaml(path) {
  const text = readText(path);
  if (!text) return {};
  try {
    return objectValue(YAML.parse(text));
  } catch {
    return {};
  }
}

function nestedValue(data, path) {
  return path.split(".").reduce((current, part) => {
    const obj = objectValue(current);
    return obj[part];
  }, data);
}

function readEnvFile(path) {
  const out = {};
  for (const line of readText(path).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (key) out[key] = value;
  }
  return out;
}

function readConfigValue(home, profile, key) {
  const candidates =
    profile && profile !== "default"
      ? [
          join(profileHome(home, profile), "config.yaml"),
          join(home, "config.yaml"),
        ]
      : [join(home, "config.yaml")];
  for (const file of candidates) {
    const value = nestedValue(readYaml(file), key);
    const normalized = stringValue(value);
    if (normalized) return normalized;
  }
  return "";
}

function readEnvValue(home, profile, key) {
  const candidates =
    profile && profile !== "default"
      ? [join(profileHome(home, profile), ".env"), join(home, ".env")]
      : [join(home, ".env")];
  for (const file of candidates) {
    const value = stringValue(readEnvFile(file)[key]);
    if (value) return value;
  }
  return "";
}

function resolveApiKey(home, profile, desktopConfig, explicitApiKey) {
  if (explicitApiKey) return explicitApiKey;
  if (desktopConfig.connectionMode === "remote") {
    return stringValue(desktopConfig.remoteApiKey);
  }
  return (
    readConfigValue(home, profile, "API_SERVER_KEY") ||
    readEnvValue(home, profile, "API_SERVER_KEY") ||
    readConfigValue(home, profile, "api_server.token")
  );
}

function readConfiguredPort(home, profile) {
  const raw = readConfigValue(home, profile, "platforms.api_server.extra.port");
  if (/^\d+$/.test(raw)) {
    const port = Number(raw);
    if (port > 0 && port < 65536) return port;
  }
  return DEFAULT_LOCAL_PORT;
}

function resolveGatewayUrl(home, profile, desktopConfig, explicitUrl) {
  if (explicitUrl) return explicitUrl;
  if (desktopConfig.connectionMode === "remote") {
    return normalizeUrl(desktopConfig.remoteUrl);
  }
  if (desktopConfig.connectionMode === "ssh") {
    return "";
  }
  return `http://127.0.0.1:${readConfiguredPort(home, profile)}`;
}

function readTelegramChatId(home, profile) {
  const desktopConfig = readJson(join(home, "desktop.json"));
  const prefsByProfile = objectValue(
    desktopConfig.ownerNotificationPrefsByProfile,
  );
  const prefs = objectValue(prefsByProfile[profile]);
  const targets = objectValue(prefs.targets);
  return stringValue(targets.telegramChatId);
}

function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets.filter(Boolean)) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

async function postGatewayChat(url, apiKey, chatId, message, timeoutMs) {
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: "hermes-agent",
      stream: false,
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: [
            `Send exactly one Telegram message to chat id ${chatId} using the Hermes messaging tool.`,
            `Message: ${message}`,
            "If Telegram is not configured or the send fails, reply with UNAVAILABLE and the reason.",
          ].join("\n"),
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`gateway ${response.status}: ${text.slice(0, 160)}`);
  }
  const data = text ? JSON.parse(text) : {};
  return data?.choices?.[0]?.message?.content ?? "";
}

function publicResult(result, secrets) {
  if (!result.gatewayReplyPreview) return result;
  return {
    ...result,
    gatewayReplyPreview: redact(result.gatewayReplyPreview, secrets),
  };
}

export async function runOwnerChannelLiveSmoke(options = {}) {
  const opts = {
    ...options,
    home: resolve(options.home || join(homedir(), ".hermes")),
    profile: options.profile || "",
    url: normalizeUrl(options.url || ""),
    apiKey: stringValue(options.apiKey),
    message: stringValue(options.message) || "Hermes owner-channel live smoke",
    send: options.send === true,
    timeoutMs:
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : 60_000,
  };
  const desktopPath = join(opts.home, "desktop.json");
  const desktopConfig = readJson(desktopPath);
  const profile = opts.profile || readActiveProfile(opts.home);
  const readiness = evaluateOwnerChannelReadiness({
    home: opts.home,
    profile,
  });
  if (readiness.status !== "ready" || readiness.telegramLiveReady !== true) {
    return {
      status: "blocked",
      reason: "telegram-not-ready",
      readiness,
    };
  }
  const chatId = readTelegramChatId(opts.home, profile);
  const gatewayUrl = resolveGatewayUrl(
    opts.home,
    profile,
    desktopConfig,
    opts.url,
  );
  const apiKey = resolveApiKey(opts.home, profile, desktopConfig, opts.apiKey);
  if (!gatewayUrl) {
    return {
      status: "blocked",
      reason: "gateway-url-unresolved",
      profile,
      readiness,
    };
  }
  const base = {
    status: opts.send ? "pending-send" : "dry-run",
    profile,
    hermesHome: opts.home,
    gatewayUrl,
    hasApiKey: Boolean(apiKey),
    telegramLiveReady: true,
    messageLength: opts.message.length,
    readiness: {
      status: readiness.status,
      profile: readiness.profile,
      telegramLiveReady: readiness.telegramLiveReady,
      readyChannels: readiness.readyChannels,
      channelDirectoryTelegramTargets:
        readiness.channelDirectoryTelegramTargets,
    },
  };
  if (!opts.send) return base;
  if (process.env[LIVE_ENV] !== "1") {
    return {
      ...base,
      status: "blocked",
      reason: "missing-live-env",
      requiredEnv: `${LIVE_ENV}=1`,
    };
  }
  const reply = await postGatewayChat(
    gatewayUrl,
    apiKey,
    chatId,
    opts.message,
    opts.timeoutMs,
  );
  const unavailable = /unavailable|fail/i.test(reply);
  return {
    ...base,
    status: unavailable ? "failed" : "sent",
    gatewayReplyPreview: reply.slice(0, 240),
  };
}

function printHelp() {
  console.log(`Usage: node scripts/owner-channel-live-smoke.mjs [--home <path>] [--profile <name>] [--url <base>] [--api-key <key>] [--message <text>] [--send]

Outbound owner-channel live smoke for Telegram. It first runs the redacted readiness gate.

Default mode is a dry run. To send exactly one Telegram smoke message, pass --send and set ${LIVE_ENV}=1.
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
    const result = await runOwnerChannelLiveSmoke(opts);
    const chatId = readTelegramChatId(
      opts.home,
      opts.profile || readActiveProfile(opts.home),
    );
    const safe = publicResult(result, [chatId, opts.apiKey]);
    console.log(JSON.stringify(safe, null, 2));
    if (result.status === "blocked") process.exit(2);
    if (result.status === "failed") process.exit(4);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
