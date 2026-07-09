#!/usr/bin/env node
// Explicit-gated live smoke for the macOS owner-delivery channel.
//
// The runner is bundled into a temp file and executed by Electron so it uses the
// same owner-delivery module and Electron Notification API as the app, while all
// persisted state stays inside an isolated HERMES_HOME.
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const electronPath = require("electron");
const LIVE_ENV = "HERMES_OWNER_MACOS_LIVE";
const SMOKE_TMP_ROOT =
  process.env.HERMES_OWNER_MACOS_SMOKE_TMPDIR ||
  (process.platform === "darwin" ? "/private/tmp" : tmpdir());

function parseArgs(argv) {
  const opts = {
    send: false,
    title: "",
    body: "",
    timeoutMs: 60_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--send") {
      opts.send = true;
    } else if (arg === "--title") {
      opts.title = argv[++i] || "";
    } else if (arg === "--body") {
      opts.body = argv[++i] || "";
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(argv[++i] || opts.timeoutMs);
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  opts.title =
    opts.title.trim() ||
    `Hermes macOS owner-delivery smoke ${new Date().toISOString()}`;
  opts.body =
    opts.body.trim() ||
    "This is a one-off Hermes owner-delivery macOS notification smoke.";
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

function runnerSource(paths) {
  return `
const { app } = require("electron");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { delimiter } = require("node:path");
const { Module } = require("node:module");

process.env.HOME = ${JSON.stringify(paths.root)};
process.env.HERMES_HOME = ${JSON.stringify(paths.home)};
process.env.NODE_PATH = [${JSON.stringify(paths.nodeModules)}, process.env.NODE_PATH]
  .filter(Boolean)
  .join(delimiter);
Module._initPaths();

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

async function main() {
  await app.whenReady();
  const { setOwnerNotificationPrefs } = require(${JSON.stringify(paths.configModule)});
  const { deliverOwnerNotification, getOwnerDeliverySummary } = require(${JSON.stringify(paths.deliveryModule)});

  mkdirSync(process.env.HERMES_HOME, { recursive: true });
  writeFileSync(
    join(process.env.HERMES_HOME, "desktop.json"),
    JSON.stringify({ onboardingCompleted: true, schedulerEnabled: false }, null, 2),
  );
  setOwnerNotificationPrefs(
    {
      channels: { macos: true, telegram: false, email: false, whatsapp: false },
      events: { brief: true, nag: true, alert: true, update: true },
      quietHours: { enabled: false },
      rateLimitMinutes: 0,
    },
    "default",
  );
  const result = await deliverOwnerNotification(
    {
      event: "brief",
      title: ${JSON.stringify(paths.title)},
      body: ${JSON.stringify(paths.body)},
      dedupeKey: "owner-macos-delivery-smoke",
      idempotencyKey: "owner-macos-delivery-smoke-" + Date.now().toString(36),
      respectQuietHours: false,
    },
    "default",
  );
  const summary = getOwnerDeliverySummary("default");
  const payload = {
    result,
    summary,
    desktopConfig: readJson(join(process.env.HERMES_HOME, "desktop.json")),
  };
  writeFileSync(${JSON.stringify(paths.resultPath)}, JSON.stringify(payload, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 500));
  app.quit();
}

main().catch((err) => {
  writeFileSync(
    ${JSON.stringify(paths.resultPath)},
    JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2),
  );
  app.exit(1);
});
`;
}

async function bundleRunner(paths) {
  writeFileSync(paths.entryPath, runnerSource(paths));
  await build({
    entryPoints: [paths.entryPath],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: paths.bundlePath,
    external: ["electron", "better-sqlite3"],
    logLevel: "silent",
  });
}

async function runSmoke(opts) {
  if (!opts.send) {
    return {
      status: "dry-run",
      requiredForSend: [`--send`, `${LIVE_ENV}=1`],
      titleLength: opts.title.length,
      bodyLength: opts.body.length,
    };
  }
  if (process.env[LIVE_ENV] !== "1") {
    return {
      status: "blocked",
      reason: "missing-live-env",
      requiredEnv: `${LIVE_ENV}=1`,
    };
  }

  const root = mkdtempSync(join(SMOKE_TMP_ROOT, "hermes-owner-macos-smoke-"));
  const home = join(root, ".hermes");
  mkdirSync(home, { recursive: true });
  const paths = {
    root,
    home,
    title: opts.title,
    body: opts.body,
    entryPath: join(root, "owner-macos-smoke-entry.cjs"),
    bundlePath: join(root, "owner-macos-smoke-bundle.cjs"),
    resultPath: join(root, "owner-macos-smoke-result.json"),
    nodeModules: join(process.cwd(), "node_modules"),
    configModule: resolve("src/main/config/desktop-store.ts"),
    deliveryModule: resolve("src/main/owner-delivery.ts"),
  };
  await bundleRunner(paths);
  try {
    await execFileAsync(electronPath, [paths.bundlePath], {
      env: {
        ...process.env,
        HOME: root,
        HERMES_HOME: home,
        NODE_PATH: [join(process.cwd(), "node_modules"), process.env.NODE_PATH]
          .filter(Boolean)
          .join(delimiter),
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      },
      timeout: opts.timeoutMs,
    });
  } catch (err) {
    const failed = err;
    const payload = readJson(paths.resultPath);
    throw new Error(
      [
        `Electron runner failed with code ${String(failed.code ?? failed.status ?? "unknown")}.`,
        failed.stdout ? `stdout: ${String(failed.stdout).trim()}` : "",
        failed.stderr ? `stderr: ${String(failed.stderr).trim()}` : "",
        Object.keys(payload).length > 0
          ? `result: ${JSON.stringify(payload)}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  const payload = readJson(paths.resultPath);
  const macosResult = Array.isArray(payload.result?.results)
    ? payload.result.results.find((item) => item.channel === "macos")
    : null;
  const status =
    payload.result?.ok === true && macosResult?.status === "sent"
      ? "sent"
      : "failed";
  return {
    status,
    hermesHome: home,
    ok: payload.result?.ok === true,
    macos: macosResult,
    summary: payload.summary,
    ownerPrefsEntryExists: Boolean(
      payload.desktopConfig?.ownerNotificationPrefsByProfile?.default,
    ),
  };
}

function printHelp() {
  console.log(`Usage: node scripts/owner-macos-delivery-smoke.mjs [--send] [--title <text>] [--body <text>]

Default mode is a dry run. To show one macOS owner-delivery notification, pass --send and set ${LIVE_ENV}=1.
`);
}

try {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  const result = await runSmoke(opts);
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked") process.exit(2);
  if (result.status === "failed") process.exit(4);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
