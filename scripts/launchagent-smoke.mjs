#!/usr/bin/env node
// Disposable macOS LaunchAgent lifecycle smoke.
//
// This does not install the real Hermes scheduler. It proves that the current
// user GUI launchd domain can bootstrap, run, and boot out a temporary
// LaunchAgent without touching the production Hermes label or HERMES_HOME.

import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function runLaunchctl(args, options = {}) {
  return execFileSync("launchctl", args, {
    encoding: "utf-8",
    stdio: options.stdio ?? "pipe",
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForMarker(markerPath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) return true;
    await sleep(250);
  }
  return existsSync(markerPath);
}

function launchdGuiTarget() {
  if (typeof process.getuid !== "function") return null;
  return `gui/${process.getuid()}`;
}

if (process.platform !== "darwin") {
  console.log(
    JSON.stringify({
      ok: true,
      skipped: true,
      reason: "LaunchAgent smoke is macOS-only.",
    }),
  );
  process.exit(0);
}

const guiTarget = launchdGuiTarget();
if (!guiTarget) {
  throw new Error("Could not resolve launchd GUI target.");
}

const smokeTmpRoot =
  process.env.HERMES_LAUNCHAGENT_SMOKE_TMPDIR ||
  (process.platform === "darwin" ? "/private/tmp" : tmpdir());
const root = mkdtempSync(join(smokeTmpRoot, "hermes-launchagent-smoke-"));
const label = `com.nousresearch.hermes-scheduler.codex-smoke.${process.pid}`;
const markerPath = join(root, "marker.jsonl");
const stdoutPath = join(root, "stdout.log");
const stderrPath = join(root, "stderr.log");
const runnerPath = join(root, "runner.mjs");
const plistPath = join(root, `${label}.plist`);

const runnerSource = `
import { appendFileSync } from "node:fs";
const markerPath = process.argv[2];
appendFileSync(markerPath, JSON.stringify({
  pid: process.pid,
  ppid: process.ppid,
  smoke: process.env.HERMES_LAUNCHAGENT_SMOKE,
  ts: new Date().toISOString()
}) + "\\n");
`;

writeFileSync(runnerPath, runnerSource, "utf-8");
chmodSync(runnerPath, 0o755);

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${xmlEscape(label)}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${xmlEscape(process.execPath)}</string>
        <string>${xmlEscape(runnerPath)}</string>
        <string>${xmlEscape(markerPath)}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>3600</integer>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HERMES_LAUNCHAGENT_SMOKE</key>
        <string>1</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${xmlEscape(stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(stderrPath)}</string>
</dict>
</plist>
`;

writeFileSync(plistPath, plist, "utf-8");

let bootstrapped = false;
let passed = false;

try {
  try {
    runLaunchctl(["bootout", guiTarget, plistPath]);
  } catch {
    // Ignore stale cleanup failure for a unique label/path.
  }

  runLaunchctl(["bootstrap", guiTarget, plistPath]);
  bootstrapped = true;

  const markerWritten = await waitForMarker(markerPath, 10_000);
  if (!markerWritten) {
    throw new Error(
      `LaunchAgent did not write marker within timeout. stderr=${existsSync(stderrPath) ? readFileSync(stderrPath, "utf-8") : ""}`,
    );
  }

  const marker = readFileSync(markerPath, "utf-8").trim().split(/\r?\n/).at(-1);
  const parsedMarker = marker ? JSON.parse(marker) : {};
  if (parsedMarker.smoke !== "1") {
    throw new Error("LaunchAgent marker did not preserve smoke environment.");
  }

  passed = true;
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: false,
        label,
        guiTarget,
        markerPath,
      },
      null,
      2,
    ),
  );
} finally {
  let bootoutFailed = false;
  if (bootstrapped) {
    try {
      runLaunchctl(["bootout", guiTarget, plistPath]);
    } catch (err) {
      bootoutFailed = true;
      console.error(
        `warning: failed to bootout disposable LaunchAgent ${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (
    passed &&
    !bootoutFailed &&
    process.env.HERMES_KEEP_LAUNCHAGENT_SMOKE !== "1"
  ) {
    rmSync(root, { recursive: true, force: true });
  } else if (!passed || bootoutFailed) {
    console.error(`LaunchAgent smoke artifacts kept at ${root}`);
  }
  if (bootoutFailed) process.exitCode = 1;
}
