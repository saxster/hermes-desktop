#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const LIVE_ENV = "HERMES_MOBILE_TASK_LIVE";

function parseArgs(argv) {
  const opts = {
    home: process.env.HERMES_HOME || join(homedir(), ".hermes"),
    profile: "",
    port: Number(process.env.HERMES_MOBILE_TASK_CONTROL_PORT || 0),
    token: process.env.HERMES_MOBILE_TASK_TOKEN || "",
    text: "",
    chatId: process.env.HERMES_MOBILE_TASK_CHAT_ID || "",
    externalMessageId: "",
    write: false,
    timeoutMs: 30_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--home") {
      opts.home = argv[++i] || opts.home;
    } else if (arg === "--profile") {
      opts.profile = argv[++i] || "";
    } else if (arg === "--port") {
      opts.port = Number(argv[++i] || 0);
    } else if (arg === "--token") {
      opts.token = argv[++i] || "";
    } else if (arg === "--text") {
      opts.text = argv[++i] || "";
    } else if (arg === "--chat-id") {
      opts.chatId = argv[++i] || "";
    } else if (arg === "--external-message-id") {
      opts.externalMessageId = argv[++i] || "";
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(argv[++i] || opts.timeoutMs);
    } else if (arg === "--write") {
      opts.write = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  opts.home = resolve(opts.home);
  opts.token = opts.token.trim();
  opts.text =
    opts.text.trim() ||
    `add this as a task: Hermes mobile task live smoke ${new Date().toISOString()}`;
  opts.chatId = opts.chatId.trim();
  opts.externalMessageId =
    opts.externalMessageId.trim() ||
    `mobile-task-live-smoke-${Date.now().toString(36)}`;
  opts.timeoutMs =
    Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? Math.floor(opts.timeoutMs)
      : 30_000;
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

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function readOwnerTelegramChatId(home, profile) {
  const desktopConfig = readJson(join(home, "desktop.json"));
  const prefsByProfile = objectValue(
    desktopConfig.ownerNotificationPrefsByProfile,
  );
  const prefs = objectValue(prefsByProfile[profile]);
  const targets = objectValue(prefs.targets);
  return stringValue(targets.telegramChatId);
}

function resolveControlConfig(home, profile, opts) {
  const desktopConfig = readJson(join(home, "desktop.json"));
  const port =
    numberValue(opts.port) || numberValue(desktopConfig.controlServerPort) || 0;
  const token =
    stringValue(opts.token) ||
    stringValue(readText(join(home, "control-server.token"))) ||
    stringValue(desktopConfig.controlServerToken);
  const chatId =
    stringValue(opts.chatId) || readOwnerTelegramChatId(home, profile);
  return { port, token, chatId };
}

function resolveVaultDir(home, profile) {
  const profileDir = profileHome(home, profile);
  const cfg = readJson(join(profileDir, "sps-agent", "sps-storage.json"));
  const override = stringValue(cfg.vaultDir);
  return override || join(profileDir, "sps-agent", "vault");
}

function splitFrontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!match) return { frontmatter: "", body: markdown };
  return {
    frontmatter: match[1],
    body: markdown.slice(match[0].length),
  };
}

function parseJsonScalarFrontmatter(markdown) {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const props = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    try {
      props[key] = JSON.parse(rawValue);
    } catch {
      props[key] = rawValue;
    }
  }
  return { props, body };
}

function verifyTaskMarkdown(markdown, chatId) {
  const { props } = parseJsonScalarFrontmatter(markdown);
  const errors = [];
  const expected = {
    status: "inbox",
    route: "human",
    source: "telegram/mobile",
    captureChannel: "telegram",
    reviewRequired: true,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (props[key] !== value) errors.push(`${key}:${String(props[key])}`);
  }
  if (Object.hasOwn(props, "context")) errors.push("context:present");
  if (chatId && props.telegramChatId !== chatId) {
    errors.push("telegramChatId:mismatch");
  }
  return { ok: errors.length === 0, errors, props };
}

async function fetchJson(url, options, timeoutMs) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { response, data };
}

async function readControlState(baseUrl, token, timeoutMs) {
  return fetchJson(
    `${baseUrl}/state`,
    { headers: { Authorization: `Bearer ${token}` } },
    timeoutMs,
  );
}

async function postMobileTask(baseUrl, token, payload, timeoutMs) {
  return fetchJson(
    `${baseUrl}/sps/mobile-task`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    timeoutMs,
  );
}

function taskPathFor(home, profile, rowId) {
  return join(resolveVaultDir(home, profile), "tasks", `${rowId}.md`);
}

function redactValue(value, secrets) {
  let out = String(value);
  for (const secret of secrets.filter(Boolean)) {
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

function redactJson(value, secrets) {
  if (typeof value === "string") return redactValue(value, secrets);
  if (Array.isArray(value))
    return value.map((item) => redactJson(item, secrets));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      redactJson(item, secrets),
    ]),
  );
}

export async function runMobileTaskLiveSmoke(options = {}) {
  const opts = {
    ...options,
    home: resolve(options.home || join(homedir(), ".hermes")),
    profile: options.profile || "",
    port: Number(options.port || 0),
    token: stringValue(options.token),
    text:
      stringValue(options.text) ||
      `add this as a task: Hermes mobile task live smoke ${new Date().toISOString()}`,
    chatId: stringValue(options.chatId),
    externalMessageId:
      stringValue(options.externalMessageId) ||
      `mobile-task-live-smoke-${Date.now().toString(36)}`,
    write: options.write === true,
    timeoutMs:
      Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : 30_000,
  };
  const profile = opts.profile || readActiveProfile(opts.home);
  const { port, token, chatId } = resolveControlConfig(
    opts.home,
    profile,
    opts,
  );
  if (!port || !token) {
    return {
      status: "blocked",
      reason: "missing-control-server-config",
      profile,
      hasPort: Boolean(port),
      hasToken: Boolean(token),
    };
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  let state;
  try {
    const stateResult = await readControlState(baseUrl, token, opts.timeoutMs);
    if (!stateResult.response.ok) {
      return {
        status: "blocked",
        reason: "control-server-state-failed",
        profile,
        controlPort: port,
        httpStatus: stateResult.response.status,
      };
    }
    state = stateResult.data;
  } catch (err) {
    return {
      status: "blocked",
      reason: "control-server-unavailable",
      profile,
      controlPort: port,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const base = {
    status: opts.write ? "pending-write" : "dry-run",
    profile,
    controlPort: port,
    controlServerProfile: stringValue(state.profile),
    gatewayRunning: state.gatewayRunning === true,
    textLength: opts.text.length,
    hasChatId: Boolean(chatId),
  };
  if (!opts.write) return base;
  if (process.env[LIVE_ENV] !== "1") {
    return {
      ...base,
      status: "blocked",
      reason: "missing-live-env",
      requiredEnv: `${LIVE_ENV}=1`,
    };
  }
  const payload = {
    text: opts.text,
    channel: "telegram",
    chatId: chatId || undefined,
    externalMessageId: opts.externalMessageId,
  };
  const post = await postMobileTask(baseUrl, token, payload, opts.timeoutMs);
  if (!post.response.ok || post.data.success !== true || !post.data.rowId) {
    return {
      ...base,
      status: "failed",
      reason: "mobile-task-post-failed",
      httpStatus: post.response.status,
      response: post.data,
    };
  }
  const rowId = stringValue(post.data.rowId);
  const taskPath = taskPathFor(opts.home, profile, rowId);
  if (!existsSync(taskPath)) {
    return {
      ...base,
      status: "failed",
      reason: "task-row-not-found",
      rowId,
      taskPath,
    };
  }
  const markdown = readText(taskPath);
  const verification = verifyTaskMarkdown(markdown, chatId);
  if (!verification.ok) {
    return {
      ...base,
      status: "failed",
      reason: "task-row-verification-failed",
      rowId,
      taskPath,
      verificationErrors: verification.errors,
    };
  }
  return {
    ...base,
    status: "written",
    rowId,
    taskPath,
    verified: {
      status: verification.props.status,
      route: verification.props.route,
      source: verification.props.source,
      captureChannel: verification.props.captureChannel,
      reviewRequired: verification.props.reviewRequired,
      hasContext: Object.hasOwn(verification.props, "context"),
      hasTelegramChatId: Boolean(verification.props.telegramChatId),
    },
  };
}

function printHelp() {
  console.log(`Usage: node scripts/mobile-task-live-smoke.mjs [--home <path>] [--profile <name>] [--port <port>] [--token <token>] [--text <text>] [--chat-id <id>] [--write]

Inbound mobile-task smoke for the guarded /sps/mobile-task path. It verifies the local control server first.

Default mode is a dry run. To write one review-first SPS task row, pass --write and set ${LIVE_ENV}=1.
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
    const result = await runMobileTaskLiveSmoke(opts);
    const profile = opts.profile || readActiveProfile(opts.home);
    const { token, chatId } = resolveControlConfig(opts.home, profile, opts);
    console.log(JSON.stringify(redactJson(result, [token, chatId]), null, 2));
    if (result.status === "blocked") process.exit(2);
    if (result.status === "failed") process.exit(4);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
