import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  spawn,
  spawnSync,
  type SpawnOptions,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import {
  isAppLaunchScheduleDue,
  type AppLaunchSchedule,
  type AppLaunchTarget,
} from "../../shared/app-launcher";

const CRON_TICK_TIMEOUT_MS = 12 * 60 * 1_000;
const CURL_TIMEOUT_MS = 3_000;
const GATEWAY_RESTART_BACKOFF_MS = 2 * 60 * 1_000;

interface SyncProcessResult {
  status: number | null;
  signal?: NodeJS.Signals | null;
  error?: Error;
  stderr?: string | Buffer | null;
}

interface DetachedProcess {
  once(event: "error", listener: (error: Error) => void): unknown;
  unref(): void;
}

export interface CronRunnerRuntime {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homedir(): string;
  now(): number;
  existsSync(file: string): boolean;
  readFileSync(file: string): string;
  mkdirSync(directory: string): unknown;
  appendFileSync(file: string, value: string): void;
  writeFileSync(file: string, value: string): void;
  renameSync(from: string, to: string): void;
  spawnSync(
    command: string,
    args: string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): SyncProcessResult;
  spawn(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): DetachedProcess;
}

export interface HeadlessCronResult {
  exitCode: 0 | 1;
  profile: string;
  skippedForDesktop: boolean;
  cronStatus?: number | null;
}

interface GatewayState extends Record<string, unknown> {
  status?: string;
  profile?: string;
  port?: number;
  lastCheckAt?: number;
  lastHealthyAt?: number;
  outageStartedAt?: number;
  recoveredAt?: number;
  lastOutageDurationMs?: number;
  lastRestartAttemptAt?: number;
  restartAttempts?: number;
  lastError?: string;
}

const defaultRuntime: CronRunnerRuntime = {
  env: process.env,
  platform: process.platform,
  homedir,
  now: Date.now,
  existsSync,
  readFileSync: (file) => readFileSync(file, "utf-8"),
  mkdirSync: (directory) => mkdirSync(directory, { recursive: true }),
  appendFileSync: (file, value) => appendFileSync(file, value, "utf-8"),
  writeFileSync: (file, value) => writeFileSync(file, value, "utf-8"),
  renameSync,
  spawnSync: (command, args, options) => spawnSync(command, args, options),
  spawn: (command, args, options) => spawn(command, args, options),
};

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) || String(error);
  } catch {
    return String(error);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readRecord(
  runtime: CronRunnerRuntime,
  file: string,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(runtime.readFileSync(file));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function hermesHome(runtime: CronRunnerRuntime): string {
  return runtime.env.HERMES_HOME?.trim() || join(runtime.homedir(), ".hermes");
}

function activeProfile(runtime: CronRunnerRuntime, home: string): string {
  const activeProfilePath = join(home, "active_profile");
  try {
    if (!runtime.existsSync(activeProfilePath)) return "default";
    const profile = runtime.readFileSync(activeProfilePath).trim();
    return /^[A-Za-z0-9_-]+$/.test(profile) ? profile : "default";
  } catch {
    return "default";
  }
}

function profileHome(home: string, profile: string): string {
  return profile === "default" ? home : join(home, "profiles", profile);
}

function readHeadlessGatewayToken(
  runtime: CronRunnerRuntime,
  home: string,
): string {
  try {
    return runtime.readFileSync(join(home, "headless-gateway.token")).trim();
  } catch {
    return "";
  }
}

function appendJsonLine(
  runtime: CronRunnerRuntime,
  file: string,
  payload: Record<string, unknown>,
): void {
  try {
    runtime.mkdirSync(dirname(file));
    runtime.appendFileSync(file, `${JSON.stringify(payload)}\n`);
  } catch {
    // Background logging must not prevent the scheduler from making progress.
  }
}

function writeLog(
  runtime: CronRunnerRuntime,
  home: string,
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown> = {},
): void {
  appendJsonLine(runtime, join(home, "logs", "desktop.log"), {
    ts: new Date(runtime.now()).toISOString(),
    level,
    scope: "headless.cron-runner",
    event,
    ...details,
  });
}

function writeAuditLog(
  runtime: CronRunnerRuntime,
  home: string,
  profile: string,
  action: string,
  command: string,
): void {
  appendJsonLine(runtime, join(home, "logs", "audit.log"), {
    ts: runtime.now(),
    action,
    command,
    profile,
  });
}

function atomicWrite(
  runtime: CronRunnerRuntime,
  file: string,
  value: string,
): void {
  runtime.mkdirSync(dirname(file));
  const temporary = `${file}.tmp-${process.pid}-${runtime.now()}`;
  runtime.writeFileSync(temporary, value);
  runtime.renameSync(temporary, file);
}

function curlHealthy(
  runtime: CronRunnerRuntime,
  url: string,
  token?: string,
): boolean {
  const args = ["--silent", "--show-error", "--fail", "--max-time", "2"];
  if (token) args.push("-H", `Authorization: Bearer ${token}`);
  args.push(url);
  try {
    const result = runtime.spawnSync("/usr/bin/curl", args, {
      encoding: "utf-8",
      shell: false,
      stdio: "ignore",
      timeout: CURL_TIMEOUT_MS,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

function desktopIsAlive(
  runtime: CronRunnerRuntime,
  home: string,
  desktopConfig: Record<string, unknown>,
): boolean {
  const port = Number(desktopConfig.controlServerPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return false;

  try {
    const token = runtime
      .readFileSync(join(home, "control-server.token"))
      .trim();
    if (!token) return false;
    return curlHealthy(runtime, `http://127.0.0.1:${port}/state`, token);
  } catch {
    return false;
  }
}

function canonicalCli(
  home: string,
  profile: string,
  command: string[],
): { python: string; args: string[]; cwd: string } {
  const repo = join(home, "hermes-agent");
  const args = [join(repo, "hermes")];
  if (profile !== "default") args.push("-p", profile);
  args.push(...command);
  return {
    python: join(repo, "venv", "bin", "python"),
    args,
    cwd: repo,
  };
}

function runCanonicalTick(
  runtime: CronRunnerRuntime,
  home: string,
  profile: string,
): SyncProcessResult {
  const cli = canonicalCli(home, profile, ["cron", "tick"]);
  try {
    return runtime.spawnSync(cli.python, cli.args, {
      cwd: cli.cwd,
      encoding: "utf-8",
      env: {
        ...runtime.env,
        HERMES_HOME: home,
        HOME: runtime.homedir(),
        FAZM_HEADLESS: "1",
      },
      killSignal: "SIGTERM",
      shell: false,
      timeout: CRON_TICK_TIMEOUT_MS,
    });
  } catch (error) {
    return {
      status: null,
      error: error instanceof Error ? error : new Error(formatError(error)),
    };
  }
}

function readGatewayState(
  runtime: CronRunnerRuntime,
  file: string,
): GatewayState {
  return readRecord(runtime, file) as GatewayState;
}

function saveGatewayState(
  runtime: CronRunnerRuntime,
  file: string,
  state: GatewayState,
): void {
  atomicWrite(runtime, file, `${JSON.stringify(state, null, 2)}\n`);
}

function superviseGateway(
  runtime: CronRunnerRuntime,
  home: string,
  profile: string,
  desktopConfig: Record<string, unknown>,
  nowMs: number,
): void {
  const rawConfig = desktopConfig.gatewaySupervisor;
  if (!isRecord(rawConfig)) return;
  if (rawConfig.enabled !== true || rawConfig.mode !== "local") return;

  const port = Number(rawConfig.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return;

  const statePath = join(home, "gateway-supervision.json");
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
        restartAttempts: state.restartAttempts || 0,
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
        ...(apiServerKey ? { API_SERVER_KEY: apiServerKey } : {}),
        FAZM_HEADLESS: "1",
      },
      shell: false,
      stdio: "ignore",
    });
    child.once("error", (error) => {
      writeLog(runtime, home, "error", "gateway.restart.failed", {
        profile,
        error: formatError(error),
      });
    });
    child.unref();
    delete state.lastError;
    writeLog(runtime, home, "warn", "gateway.restart.attempted", {
      profile,
      attempt: state.restartAttempts,
    });
  } catch (error) {
    state.lastError = formatError(error);
    writeLog(runtime, home, "error", "gateway.restart.failed", {
      profile,
      error: state.lastError,
    });
  }
  saveGatewayState(runtime, statePath, state);
}

function appDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function appWeekKey(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dayOffset);
  return appDayKey(monday);
}

function appPeriodKey(schedule: AppLaunchSchedule, date: Date): string {
  if (schedule.cadence === "weekly") return appWeekKey(date);
  if (schedule.cadence === "monthly") {
    return `${date.getFullYear()}-${date.getMonth() + 1}`;
  }
  return appDayKey(date);
}

function hasRunThisPeriod(schedule: AppLaunchSchedule, now: Date): boolean {
  return (
    !!schedule.lastRunAt &&
    appPeriodKey(schedule, new Date(schedule.lastRunAt)) ===
      appPeriodKey(schedule, now)
  );
}

function missedRunWindow(schedule: AppLaunchSchedule, now: Date): boolean {
  if (!schedule.enabled || !schedule.runWhenClosed) return false;
  if (hasRunThisPeriod(schedule, now)) return false;
  if (schedule.cadence === "weekly") {
    return (
      now.getDay() > 1 || (now.getDay() === 1 && now.getHours() > schedule.hour)
    );
  }
  if (schedule.cadence === "monthly") {
    return (
      now.getDate() > 1 ||
      (now.getDate() === 1 && now.getHours() > schedule.hour)
    );
  }
  return now.getHours() > schedule.hour;
}

function parseAppRegistry(value: Record<string, unknown>): {
  targets: AppLaunchTarget[];
  schedules: AppLaunchSchedule[];
} {
  return {
    targets: Array.isArray(value.targets)
      ? (value.targets.filter(isRecord) as unknown as AppLaunchTarget[])
      : [],
    schedules: Array.isArray(value.schedules)
      ? (value.schedules.filter(isRecord) as unknown as AppLaunchSchedule[])
      : [],
  };
}

function runAppLaunchSchedule(
  runtime: CronRunnerRuntime,
  home: string,
  profile: string,
  schedule: AppLaunchSchedule,
  targets: AppLaunchTarget[],
  nowMs: number,
): void {
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

    const args = target.locator.bundleId
      ? ["-b", target.locator.bundleId]
      : [target.locator.appPath];
    let result: SyncProcessResult;
    try {
      result = runtime.spawnSync("/usr/bin/open", args, {
        encoding: "utf-8",
        shell: false,
      });
    } catch (error) {
      result = {
        status: null,
        error: error instanceof Error ? error : new Error(formatError(error)),
      };
    }
    target.lastRunAt = runtime.now();
    target.lastStatus = result.error || result.status !== 0 ? "failed" : "ok";
    if (target.lastStatus === "failed") {
      target.lastError = result.error
        ? formatError(result.error)
        : `open exited with status ${result.status}`;
      failed = target.lastError;
      writeAuditLog(
        runtime,
        home,
        profile,
        "app-launch.failure.scheduled",
        `macos-app:${target.label}`,
      );
    } else {
      delete target.lastError;
      writeAuditLog(
        runtime,
        home,
        profile,
        "app-launch.run.scheduled",
        `macos-app:${target.label}`,
      );
    }
  }

  schedule.lastRunAt = nowMs;
  schedule.lastStatus = failed ? "failed" : "ok";
  if (failed) schedule.lastError = failed;
  else delete schedule.lastError;
}

function runAppLaunchSchedules(
  runtime: CronRunnerRuntime,
  home: string,
  profile: string,
  nowMs: number,
): void {
  if (runtime.platform !== "darwin") return;
  const registryPath = join(
    profileHome(home, profile),
    "sps-agent",
    "app-launcher.json",
  );
  if (!runtime.existsSync(registryPath)) return;

  try {
    const registry = parseAppRegistry(readRecord(runtime, registryPath));
    const now = new Date(nowMs);
    let changed = false;
    for (const schedule of registry.schedules) {
      if (
        !schedule ||
        schedule.enabled !== true ||
        schedule.runWhenClosed !== true
      ) {
        continue;
      }
      if (isAppLaunchScheduleDue(schedule, now)) {
        runAppLaunchSchedule(
          runtime,
          home,
          profile,
          schedule,
          registry.targets,
          nowMs,
        );
        writeAuditLog(
          runtime,
          home,
          profile,
          "app-launch.schedule.run.scheduled",
          schedule.label,
        );
        changed = true;
        continue;
      }
      if (missedRunWindow(schedule, now)) {
        schedule.lastRunAt = nowMs;
        schedule.lastStatus = "skipped";
        schedule.lastError =
          "Scheduled hour passed before Hermes could run it.";
        writeAuditLog(
          runtime,
          home,
          profile,
          "app-launch.schedule.skipped",
          schedule.label,
        );
        changed = true;
      }
    }
    if (changed) {
      atomicWrite(
        runtime,
        registryPath,
        `${JSON.stringify(registry, null, 2)}\n`,
      );
    }
  } catch (error) {
    writeLog(runtime, home, "error", "app-launch.failed", {
      error: formatError(error),
    });
  }
}

export function runHeadlessCron(
  runtime: CronRunnerRuntime = defaultRuntime,
): HeadlessCronResult {
  const home = hermesHome(runtime);
  const profile = activeProfile(runtime, home);
  const desktopConfig = readRecord(runtime, join(home, "desktop.json"));

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
      signal: tick.signal || undefined,
      error: tick.error ? formatError(tick.error) : undefined,
    },
  );

  const nowMs = runtime.now();
  superviseGateway(runtime, home, profile, desktopConfig, nowMs);
  runAppLaunchSchedules(runtime, home, profile, nowMs);

  return {
    exitCode: tickSucceeded ? 0 : 1,
    profile,
    skippedForDesktop: false,
    cronStatus: tick.status,
  };
}

export function main(runtime: CronRunnerRuntime = defaultRuntime): number {
  try {
    return runHeadlessCron(runtime).exitCode;
  } catch (error) {
    const home = hermesHome(runtime);
    writeLog(runtime, home, "error", "runner.fatal", {
      error: formatError(error),
    });
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}
