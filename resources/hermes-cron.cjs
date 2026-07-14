var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/headless/cron-runner.ts
var cron_runner_exports = {};
__export(cron_runner_exports, {
  main: () => main,
  runHeadlessCron: () => runHeadlessCron
});
module.exports = __toCommonJS(cron_runner_exports);
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");
var import_node_child_process = require("node:child_process");

// src/shared/app-launcher.ts
function ymd(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function weekKey(d) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dow);
  return ymd(monday);
}
function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}
function periodKey(cadence, d) {
  if (cadence === "weekly") return weekKey(d);
  if (cadence === "monthly") return monthKey(d);
  return ymd(d);
}
function isRunWindow(cadence, hour, now) {
  if (now.getHours() !== hour) return false;
  if (cadence === "weekly") return now.getDay() === 1;
  if (cadence === "monthly") return now.getDate() === 1;
  return true;
}
function isAppLaunchScheduleDue(schedule, now) {
  if (!schedule.enabled) return false;
  if (!isRunWindow(schedule.cadence, schedule.hour, now)) return false;
  if (!schedule.lastRunAt) return true;
  return periodKey(schedule.cadence, now) !== periodKey(schedule.cadence, new Date(schedule.lastRunAt));
}

// src/main/headless/cron-runner.ts
var CRON_TICK_TIMEOUT_MS = 12 * 60 * 1e3;
var CURL_TIMEOUT_MS = 3e3;
var GATEWAY_RESTART_BACKOFF_MS = 2 * 60 * 1e3;
var defaultRuntime = {
  env: process.env,
  platform: process.platform,
  homedir: import_node_os.homedir,
  now: Date.now,
  existsSync: import_node_fs.existsSync,
  readFileSync: (file) => (0, import_node_fs.readFileSync)(file, "utf-8"),
  mkdirSync: (directory) => (0, import_node_fs.mkdirSync)(directory, { recursive: true }),
  appendFileSync: (file, value) => (0, import_node_fs.appendFileSync)(file, value, "utf-8"),
  writeFileSync: (file, value) => (0, import_node_fs.writeFileSync)(file, value, "utf-8"),
  renameSync: import_node_fs.renameSync,
  spawnSync: (command, args, options) => (0, import_node_child_process.spawnSync)(command, args, options),
  spawn: (command, args, options) => (0, import_node_child_process.spawn)(command, args, options)
};
function formatError(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return String(error);
  }
}
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function readRecord(runtime, file) {
  try {
    const parsed = JSON.parse(runtime.readFileSync(file));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function hermesHome(runtime) {
  return runtime.env.HERMES_HOME?.trim() || (0, import_node_path.join)(runtime.homedir(), ".hermes");
}
function activeProfile(runtime, home) {
  const activeProfilePath = (0, import_node_path.join)(home, "active_profile");
  try {
    if (!runtime.existsSync(activeProfilePath)) return "default";
    const profile = runtime.readFileSync(activeProfilePath).trim();
    return /^[A-Za-z0-9_-]+$/.test(profile) ? profile : "default";
  } catch {
    return "default";
  }
}
function profileHome(home, profile) {
  return profile === "default" ? home : (0, import_node_path.join)(home, "profiles", profile);
}
function readHeadlessGatewayToken(runtime, home) {
  try {
    return runtime.readFileSync((0, import_node_path.join)(home, "headless-gateway.token")).trim();
  } catch {
    return "";
  }
}
function appendJsonLine(runtime, file, payload) {
  try {
    runtime.mkdirSync((0, import_node_path.dirname)(file));
    runtime.appendFileSync(file, `${JSON.stringify(payload)}
`);
  } catch {
  }
}
function writeLog(runtime, home, level, event, details = {}) {
  appendJsonLine(runtime, (0, import_node_path.join)(home, "logs", "desktop.log"), {
    ts: new Date(runtime.now()).toISOString(),
    level,
    scope: "headless.cron-runner",
    event,
    ...details
  });
}
function writeAuditLog(runtime, home, profile, action, command) {
  appendJsonLine(runtime, (0, import_node_path.join)(home, "logs", "audit.log"), {
    ts: runtime.now(),
    action,
    command,
    profile
  });
}
function atomicWrite(runtime, file, value) {
  runtime.mkdirSync((0, import_node_path.dirname)(file));
  const temporary = `${file}.tmp-${process.pid}-${runtime.now()}`;
  runtime.writeFileSync(temporary, value);
  runtime.renameSync(temporary, file);
}
function curlHealthy(runtime, url, token) {
  const args = ["--silent", "--show-error", "--fail", "--max-time", "2"];
  if (token) args.push("-H", `Authorization: Bearer ${token}`);
  args.push(url);
  try {
    const result = runtime.spawnSync("/usr/bin/curl", args, {
      encoding: "utf-8",
      shell: false,
      stdio: "ignore",
      timeout: CURL_TIMEOUT_MS
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}
function desktopIsAlive(runtime, home, desktopConfig) {
  const port = Number(desktopConfig.controlServerPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return false;
  try {
    const token = runtime.readFileSync((0, import_node_path.join)(home, "control-server.token")).trim();
    if (!token) return false;
    return curlHealthy(runtime, `http://127.0.0.1:${port}/state`, token);
  } catch {
    return false;
  }
}
function canonicalCli(home, profile, command) {
  const repo = (0, import_node_path.join)(home, "hermes-agent");
  const args = [(0, import_node_path.join)(repo, "hermes")];
  if (profile !== "default") args.push("-p", profile);
  args.push(...command);
  return {
    python: (0, import_node_path.join)(repo, "venv", "bin", "python"),
    args,
    cwd: repo
  };
}
function runCanonicalTick(runtime, home, profile) {
  const cli = canonicalCli(home, profile, ["cron", "tick"]);
  try {
    return runtime.spawnSync(cli.python, cli.args, {
      cwd: cli.cwd,
      encoding: "utf-8",
      env: {
        ...runtime.env,
        HERMES_HOME: home,
        HOME: runtime.homedir(),
        FAZM_HEADLESS: "1"
      },
      killSignal: "SIGTERM",
      shell: false,
      timeout: CRON_TICK_TIMEOUT_MS
    });
  } catch (error) {
    return {
      status: null,
      error: error instanceof Error ? error : new Error(formatError(error))
    };
  }
}
function readGatewayState(runtime, file) {
  return readRecord(runtime, file);
}
function saveGatewayState(runtime, file, state) {
  atomicWrite(runtime, file, `${JSON.stringify(state, null, 2)}
`);
}
function superviseGateway(runtime, home, profile, desktopConfig, nowMs) {
  const rawConfig = desktopConfig.gatewaySupervisor;
  if (!isRecord(rawConfig)) return;
  if (rawConfig.enabled !== true || rawConfig.mode !== "local") return;
  const port = Number(rawConfig.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return;
  const statePath = (0, import_node_path.join)(home, "gateway-supervision.json");
  const state = readGatewayState(runtime, statePath);
  state.lastCheckAt = nowMs;
  state.profile = profile;
  state.port = port;
  if (curlHealthy(runtime, `http://127.0.0.1:${port}/health`)) {
    state.status = "healthy";
    state.lastHealthyAt = nowMs;
    if (typeof state.outageStartedAt === "number") {
      state.recoveredAt = nowMs;
      state.lastOutageDurationMs = Math.max(0, nowMs - state.outageStartedAt);
      delete state.outageStartedAt;
      writeLog(runtime, home, "warn", "gateway.recovered", {
        outageDurationMs: state.lastOutageDurationMs,
        restartAttempts: state.restartAttempts || 0
      });
    }
    saveGatewayState(runtime, statePath, state);
    return;
  }
  state.status = "outage";
  if (typeof state.outageStartedAt !== "number") {
    state.outageStartedAt = nowMs;
    state.restartAttempts = 0;
    writeLog(runtime, home, "error", "gateway.outage", { profile, port });
  }
  const lastAttempt = Number(state.lastRestartAttemptAt) || 0;
  if (nowMs - lastAttempt < GATEWAY_RESTART_BACKOFF_MS) {
    saveGatewayState(runtime, statePath, state);
    return;
  }
  const cli = canonicalCli(home, profile, ["gateway", "run"]);
  const apiServerKey = readHeadlessGatewayToken(runtime, home);
  state.lastRestartAttemptAt = nowMs;
  state.restartAttempts = (Number(state.restartAttempts) || 0) + 1;
  try {
    const child = runtime.spawn(cli.python, cli.args, {
      cwd: cli.cwd,
      detached: true,
      env: {
        ...runtime.env,
        HERMES_HOME: home,
        HOME: runtime.homedir(),
        API_SERVER_ENABLED: "true",
        API_SERVER_PORT: String(port),
        ...apiServerKey ? { API_SERVER_KEY: apiServerKey } : {},
        FAZM_HEADLESS: "1"
      },
      shell: false,
      stdio: "ignore"
    });
    child.once("error", (error) => {
      writeLog(runtime, home, "error", "gateway.restart.failed", {
        profile,
        error: formatError(error)
      });
    });
    child.unref();
    delete state.lastError;
    writeLog(runtime, home, "warn", "gateway.restart.attempted", {
      profile,
      attempt: state.restartAttempts
    });
  } catch (error) {
    state.lastError = formatError(error);
    writeLog(runtime, home, "error", "gateway.restart.failed", {
      profile,
      error: state.lastError
    });
  }
  saveGatewayState(runtime, statePath, state);
}
function appDayKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
function appWeekKey(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dayOffset);
  return appDayKey(monday);
}
function appPeriodKey(schedule, date) {
  if (schedule.cadence === "weekly") return appWeekKey(date);
  if (schedule.cadence === "monthly") {
    return `${date.getFullYear()}-${date.getMonth() + 1}`;
  }
  return appDayKey(date);
}
function hasRunThisPeriod(schedule, now) {
  return !!schedule.lastRunAt && appPeriodKey(schedule, new Date(schedule.lastRunAt)) === appPeriodKey(schedule, now);
}
function missedRunWindow(schedule, now) {
  if (!schedule.enabled || !schedule.runWhenClosed) return false;
  if (hasRunThisPeriod(schedule, now)) return false;
  if (schedule.cadence === "weekly") {
    return now.getDay() > 1 || now.getDay() === 1 && now.getHours() > schedule.hour;
  }
  if (schedule.cadence === "monthly") {
    return now.getDate() > 1 || now.getDate() === 1 && now.getHours() > schedule.hour;
  }
  return now.getHours() > schedule.hour;
}
function parseAppRegistry(value) {
  return {
    targets: Array.isArray(value.targets) ? value.targets.filter(isRecord) : [],
    schedules: Array.isArray(value.schedules) ? value.schedules.filter(isRecord) : []
  };
}
function runAppLaunchSchedule(runtime, home, profile, schedule, targets, nowMs) {
  let failed = "";
  for (const targetId of schedule.targetIds || []) {
    const target = targets.find((item) => item.id === targetId);
    if (!target || target.enabled === false) {
      failed = "Launch target is unavailable.";
      continue;
    }
    if (target.locator?.kind !== "macos-app") {
      failed = "Run while closed supports macOS app targets only.";
      continue;
    }
    const args = target.locator.bundleId ? ["-b", target.locator.bundleId] : [target.locator.appPath];
    let result;
    try {
      result = runtime.spawnSync("/usr/bin/open", args, {
        encoding: "utf-8",
        shell: false
      });
    } catch (error) {
      result = {
        status: null,
        error: error instanceof Error ? error : new Error(formatError(error))
      };
    }
    target.lastRunAt = runtime.now();
    target.lastStatus = result.error || result.status !== 0 ? "failed" : "ok";
    if (target.lastStatus === "failed") {
      target.lastError = result.error ? formatError(result.error) : `open exited with status ${result.status}`;
      failed = target.lastError;
      writeAuditLog(
        runtime,
        home,
        profile,
        "app-launch.failure.scheduled",
        `macos-app:${target.label}`
      );
    } else {
      delete target.lastError;
      writeAuditLog(
        runtime,
        home,
        profile,
        "app-launch.run.scheduled",
        `macos-app:${target.label}`
      );
    }
  }
  schedule.lastRunAt = nowMs;
  schedule.lastStatus = failed ? "failed" : "ok";
  if (failed) schedule.lastError = failed;
  else delete schedule.lastError;
}
function runAppLaunchSchedules(runtime, home, profile, nowMs) {
  if (runtime.platform !== "darwin") return;
  const registryPath = (0, import_node_path.join)(
    profileHome(home, profile),
    "sps-agent",
    "app-launcher.json"
  );
  if (!runtime.existsSync(registryPath)) return;
  try {
    const registry = parseAppRegistry(readRecord(runtime, registryPath));
    const now = new Date(nowMs);
    let changed = false;
    for (const schedule of registry.schedules) {
      if (!schedule || schedule.enabled !== true || schedule.runWhenClosed !== true) {
        continue;
      }
      if (isAppLaunchScheduleDue(schedule, now)) {
        runAppLaunchSchedule(
          runtime,
          home,
          profile,
          schedule,
          registry.targets,
          nowMs
        );
        writeAuditLog(
          runtime,
          home,
          profile,
          "app-launch.schedule.run.scheduled",
          schedule.label
        );
        changed = true;
        continue;
      }
      if (missedRunWindow(schedule, now)) {
        schedule.lastRunAt = nowMs;
        schedule.lastStatus = "skipped";
        schedule.lastError = "Scheduled hour passed before Hermes could run it.";
        writeAuditLog(
          runtime,
          home,
          profile,
          "app-launch.schedule.skipped",
          schedule.label
        );
        changed = true;
      }
    }
    if (changed) {
      atomicWrite(
        runtime,
        registryPath,
        `${JSON.stringify(registry, null, 2)}
`
      );
    }
  } catch (error) {
    writeLog(runtime, home, "error", "app-launch.failed", {
      error: formatError(error)
    });
  }
}
function runHeadlessCron(runtime = defaultRuntime) {
  const home = hermesHome(runtime);
  const profile = activeProfile(runtime, home);
  const desktopConfig = readRecord(runtime, (0, import_node_path.join)(home, "desktop.json"));
  if (desktopIsAlive(runtime, home, desktopConfig)) {
    writeLog(runtime, home, "info", "desktop-alive.skip", { profile });
    return { exitCode: 0, profile, skippedForDesktop: true };
  }
  const tick = runCanonicalTick(runtime, home, profile);
  const tickSucceeded = !tick.error && tick.status === 0;
  writeLog(
    runtime,
    home,
    tickSucceeded ? "info" : "error",
    tickSucceeded ? "cron.tick.completed" : "cron.tick.failed",
    {
      profile,
      status: tick.status,
      signal: tick.signal || void 0,
      error: tick.error ? formatError(tick.error) : void 0
    }
  );
  const nowMs = runtime.now();
  superviseGateway(runtime, home, profile, desktopConfig, nowMs);
  runAppLaunchSchedules(runtime, home, profile, nowMs);
  return {
    exitCode: tickSucceeded ? 0 : 1,
    profile,
    skippedForDesktop: false,
    cronStatus: tick.status
  };
}
function main(runtime = defaultRuntime) {
  try {
    return runHeadlessCron(runtime).exitCode;
  } catch (error) {
    const home = hermesHome(runtime);
    writeLog(runtime, home, "error", "runner.fatal", {
      error: formatError(error)
    });
    return 1;
  }
}
if (require.main === module) {
  process.exitCode = main();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  main,
  runHeadlessCron
});
