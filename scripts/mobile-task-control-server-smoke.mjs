#!/usr/bin/env node
// Launches Hermes Desktop against an isolated HOME/HERMES_HOME, then writes one
// mobile task through the real authenticated control server.
import { _electron as electron } from "playwright";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMobileTaskLiveSmoke } from "./mobile-task-live-smoke.mjs";

const LIVE_ENV = "HERMES_MOBILE_TASK_LIVE";
const WATCHDOG_MS = 120_000;
const CONTROL_WAIT_MS = 45_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function seedHermesHome(home) {
  const binDir = join(home, "hermes-agent", "venv", "bin");
  const spsDir = join(home, "sps-agent");
  const vaultDir = join(spsDir, "vault");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(vaultDir, "tasks"), { recursive: true });

  const pythonShim = join(binDir, "python");
  writeFileSync(
    pythonShim,
    `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  try {
    const req = JSON.parse(line);
    const cmd = req.cmd;
    const result =
      cmd === "status"
        ? { ok: true, txtai_installed: false }
        : cmd === "index"
          ? { ok: true, engine: "mobile-task-smoke", notes: 0 }
          : cmd === "search"
            ? { results: [] }
            : cmd === "graph"
              ? { nodes: [], edges: [] }
              : cmd === "rag"
                ? { context: [] }
                : { error: "Unknown command: " + cmd };
    console.log(JSON.stringify({ id: req.id, result }));
  } catch (err) {
    console.log(JSON.stringify({ id: 0, error: String(err && err.message ? err.message : err) }));
  }
});
`,
  );
  chmodSync(pythonShim, 0o755);
  writeFileSync(join(home, "hermes-agent", "hermes"), "");
  writeFileSync(
    join(home, ".env"),
    "ANTHROPIC_API_KEY=sk-ant-smoke-0000000000\n",
  );
  writeFileSync(
    join(home, "desktop.json"),
    JSON.stringify(
      {
        onboardingCompleted: true,
        schedulerEnabled: false,
        backgroundSchedulingEnabled: false,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(home, "config.yaml"),
    "model:\n  provider: anthropic\n  default: claude-3-5-sonnet\n",
  );
  writeFileSync(
    join(spsDir, "workspace.json"),
    JSON.stringify({ tree: [], meta: {}, docs: {}, comments: [], trash: [] }),
  );
}

async function waitForControlConfig(home) {
  const desktopPath = join(home, "desktop.json");
  const tokenPath = join(home, "control-server.token");
  const started = Date.now();
  let last = {};
  while (Date.now() - started < CONTROL_WAIT_MS) {
    last = readJson(desktopPath);
    const port = Number(last.controlServerPort || 0);
    const token =
      typeof last.controlServerToken === "string"
        ? last.controlServerToken
        : "";
    if (port > 0 && token && existsSync(tokenPath)) {
      return { port, hasTokenFile: true };
    }
    await sleep(250);
  }
  throw new Error(
    `control server config was not written within ${CONTROL_WAIT_MS}ms; last desktop.json=${JSON.stringify(
      last,
    )}`,
  );
}

async function run() {
  const root = mkdtempSync(join(tmpdir(), "hermes-mobile-control-smoke-"));
  const home = join(root, ".hermes");
  mkdirSync(home, { recursive: true });
  seedHermesHome(home);

  const watchdog = setTimeout(() => {
    console.error("WATCHDOG_TIMEOUT");
    process.exit(2);
  }, WATCHDOG_MS);
  watchdog.unref();

  let app;
  try {
    app = await electron.launch({
      args: [".", `--user-data-dir=${join(root, "electron-userdata")}`],
      env: {
        ...process.env,
        HOME: root,
        HERMES_HOME: home,
        ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
      },
    });
    const win = await app.firstWindow({ timeout: 60_000 });
    await win.waitForLoadState("domcontentloaded");
    await waitForControlConfig(home);

    const previousLive = process.env[LIVE_ENV];
    process.env[LIVE_ENV] = "1";
    try {
      const result = await runMobileTaskLiveSmoke({
        home,
        text: "add this as a task: Check Friday guard roster",
        chatId: "mobile-task-control-smoke-chat",
        externalMessageId: "mobile-task-control-smoke",
        write: true,
        timeoutMs: 30_000,
      });
      if (result.status !== "written") {
        throw new Error(
          `mobile task smoke did not write: ${JSON.stringify(result)}`,
        );
      }
      const config = await waitForControlConfig(home);
      console.log(
        JSON.stringify(
          {
            status: "passed",
            hermesHome: home,
            controlPort: config.port,
            hasTokenFile: config.hasTokenFile,
            rowId: result.rowId,
            taskPath: result.taskPath,
            verified: result.verified,
          },
          null,
          2,
        ),
      );
    } finally {
      if (previousLive === undefined) {
        delete process.env[LIVE_ENV];
      } else {
        process.env[LIVE_ENV] = previousLive;
      }
    }
  } finally {
    clearTimeout(watchdog);
    await app?.close().catch(() => {});
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
