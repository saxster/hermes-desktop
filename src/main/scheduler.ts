import { spawn } from "child_process";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import { desktopCapturer, app, powerMonitor } from "electron";
import { HERMES_HOME, HERMES_PYTHON, hermesCliArgs } from "./installer";
import { nagTick } from "./nag-engine";
import { runEmailMonitorNow, getEmailMonitorConfig } from "./email-monitor";
import { emailMonitorHasActiveAccount } from "../shared/email-monitor";
import { runInboxDigestNow } from "./inbox-digest";
import { INBOX_DIGEST_HOUR_LOCAL } from "../shared/inbox-digest";
import {
  decideLockAcquisition,
  parseLockRecord,
  serializeLockRecord,
  type LockRecord,
} from "./scheduler-lock";
import { formatLogError, log } from "./log";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import { listCronJobs, engineCronTickerIsAlive } from "./cronjobs";
import { triggerSelfHealing } from "./self-healing";
import {
  getConnectionConfig,
  readDesktopConfig,
  writeDesktopConfig,
} from "./config";
import { runDreamCycle } from "./dream-cycle";
import { maybeRunHermesAgentUpdateRoutine } from "./hermes-agent-updates";
import { maybeRunHermesUpstreamWatchRoutine } from "./hermes-upstream-watch";
import { maybeRunDesktopUpdateRoutine } from "./desktop-update-routine";
import { maybeRunAppLaunchSchedules } from "./app-launcher";
import { getApiUrl, getRemoteAuthHeader } from "./hermes";
import { gatewayFetch } from "./security/network-policy";
import { createLearningProposal } from "./learning-proposals";
import { listInstalledSkills, getSkillContent } from "./skills";
import { drainTaskProposalSpool } from "./task-proposal-bridge";
import { retryQueuedOwnerDeliveries } from "./owner-delivery";
import { createActiveWorkRun, updateActiveWorkRun } from "./active-work-runs";
import type { ActiveWorkRun } from "../shared/active-work";

export async function captureScreenshot(
  jobId: string,
  profile: string,
): Promise<string | null> {
  if (!app.isReady()) {
    return null;
  }

  try {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });

    if (sources.length === 0) {
      return null;
    }

    const pngBuffer = sources[0].thumbnail.toPNG();
    const logDir = join(profileHome(profile), "logs", "routines");
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = join(
      logDir,
      `routine-${jobId}-${timestamp}-error.png`,
    );
    writeFileSync(screenshotPath, pngBuffer);
    log.info("scheduler", {
      msg: "saved error screenshot",
      jobId,
      profile,
      path: screenshotPath,
    });
    return screenshotPath;
  } catch (err) {
    log.error("scheduler", {
      msg: "failed to capture screenshot",
      jobId,
      profile,
      error: formatLogError(err),
    });
    return null;
  }
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
const activeRuns = new Map<string, boolean>();

// Phase 1.2 — self-healing routine locks.
//
// A run that overshoots this is presumed wedged: its lock becomes stealable and a
// reap timer kills the child and releases the lock so the job can run again.
const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const CRON_OUTPUT_AUDIT_LIMIT = 64 * 1024;

async function createCronOutcomeRun(
  jobId: string,
  jobName: string,
  logFilePath: string,
  profile: string,
): Promise<ActiveWorkRun> {
  return createActiveWorkRun(
    {
      source: "cron-job",
      trigger: "cron",
      reviewPolicy: "review-first",
      title: jobName,
      goal: `Run scheduled job "${jobName}" and preserve its actual output.`,
      clientRunId: `cron:${jobId}:${Date.now()}`,
      taskId: jobId,
      criteria: [
        {
          text: "The scheduled process exits successfully without a [SILENT] result.",
        },
      ],
      expectedArtifacts: [
        { kind: "transcript", label: "Run transcript", required: true },
      ],
    },
    profile,
  ).then((run) =>
    updateActiveWorkRun(
      run.id,
      {
        artifacts: [
          {
            id: `transcript-${run.id}`,
            kind: "transcript",
            label: "Run transcript",
            ref: logFilePath,
            createdAt: Date.now(),
          },
        ],
      },
      profile,
    ).then((updated) => updated ?? run),
  );
}

async function settleCronOutcomeRun(
  run: ActiveWorkRun,
  result:
    | { status: "completed"; summary: string }
    | { status: "failed"; error: string },
  profile: string,
): Promise<void> {
  const artifact = run.artifacts.find(
    (candidate) => candidate.kind === "transcript",
  );
  const now = Date.now();
  await updateActiveWorkRun(
    run.id,
    result.status === "completed"
      ? {
          status: "completed",
          criteria: run.criteria.map((criterion) => ({
            ...criterion,
            done: true,
            evidence: {
              summary: result.summary,
              artifactId: artifact?.id,
              verifiedAt: now,
              verifiedBy: "system",
            },
          })),
          summary: result.summary,
          completedAt: now,
        }
      : {
          status: "failed",
          error: result.error,
          summary: result.error,
          completedAt: now,
        },
    profile,
  );
}

function lockDir(): string {
  return join(HERMES_HOME, "locks");
}

function lockPathFor(jobId: string): string {
  return join(lockDir(), `${jobId}.lock`);
}

// `process.kill(pid, 0)` sends no signal but performs the permission/existence
// check: ESRCH => the process is gone; EPERM => alive but not ours (still alive).
function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readExistingLock(lockFile: string): LockRecord | null {
  if (!existsSync(lockFile)) return null;
  try {
    return parseLockRecord(readFileSync(lockFile, "utf-8"));
  } catch {
    return null;
  }
}

// Persisted skip telemetry so a job that the scheduler keeps skipping is visible
// rather than silently dead. Exposed via IPC (get-scheduler-skips); the Scheduled
// modal surfaces it in Phase 2.2.
export interface JobSkipInfo {
  skipCount: number;
  lastSkipAt: number;
  lastReason: string;
}

function skipsPath(): string {
  return join(HERMES_HOME, "scheduler-skips.json");
}

export function getSchedulerSkips(): Record<string, JobSkipInfo> {
  try {
    const raw = readFileSync(skipsPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, JobSkipInfo>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function recordSkip(jobId: string, reason: string): void {
  try {
    const all = getSchedulerSkips();
    const prev = all[jobId];
    all[jobId] = {
      skipCount: (prev?.skipCount ?? 0) + 1,
      lastSkipAt: Date.now(),
      lastReason: reason,
    };
    safeWriteFile(skipsPath(), JSON.stringify(all, null, 2));
  } catch (err) {
    log.error("scheduler", {
      msg: "failed to persist skip telemetry",
      jobId,
      reason,
      error: formatLogError(err),
    });
  }
}

function clearSkip(jobId: string): void {
  try {
    const all = getSchedulerSkips();
    if (all[jobId]) {
      delete all[jobId];
      safeWriteFile(skipsPath(), JSON.stringify(all, null, 2));
    }
  } catch {
    // best-effort
  }
}

export interface SchedulerConfig {
  enabled: boolean;
  tickIntervalMs: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: true,
  tickIntervalMs: 10000, // 10 seconds tick
};

export function getSchedulerConfig(): SchedulerConfig {
  const config = readDesktopConfig();
  return {
    enabled:
      typeof config.schedulerEnabled === "boolean"
        ? config.schedulerEnabled
        : DEFAULT_CONFIG.enabled,
    tickIntervalMs:
      typeof config.schedulerIntervalMs === "number"
        ? config.schedulerIntervalMs
        : DEFAULT_CONFIG.tickIntervalMs,
  };
}

export function setSchedulerConfig(settings: Partial<SchedulerConfig>): void {
  const config = readDesktopConfig();
  if (settings.enabled !== undefined) {
    config.schedulerEnabled = settings.enabled;
  }
  if (settings.tickIntervalMs !== undefined) {
    config.schedulerIntervalMs = settings.tickIntervalMs;
  }
  writeDesktopConfig(config);

  // Restart scheduler with new config if running
  stopScheduler();
  if (config.schedulerEnabled !== false) {
    startScheduler();
  }
}

let last3AmRunDate = "";
let wasIdle = false;

/**
 * Check and execute due cron jobs for the active profile.
 */
// The nag engine runs on the scheduler tick (10s) but is throttled to ~60s so
// overdue chasing stays cheap.
const NAG_TICK_THROTTLE_MS = 60_000;
let lastNagTickMs = 0;

// The email monitor polls IMAP on the scheduler tick but is throttled well
// above the 10s tick so we don't hammer the mail server. It only fires when at
// least one account is enabled with credentials.
const EMAIL_TICK_THROTTLE_MS = 5 * 60_000;
let lastEmailTickMs = 0;

// The inbox digest runs once per local calendar day (at/after 17:00) from the
// scheduler tick; this records the local date key of the last triggered day.
let lastInboxDigestDate = "";

// The tick runs every 10s but the engine ticker only beats every 60s, so log the
// hand-off at most once a minute instead of six times.
const ENGINE_DISPATCH_LOG_THROTTLE_MS = 60_000;
let lastEngineDispatchLogMs = 0;

export async function tickScheduler(profile?: string): Promise<void> {
  const activeProfile = profile ?? getActiveProfileNameSync();

  // Check 3:00 AM local time Dream Cycle trigger
  try {
    const now = new Date();
    // Use a LOCAL calendar-date key to match the local getHours() gate. Mixing a
    // UTC date (toISOString) with a local hour double-fires the "once daily"
    // Dream Cycle east of UTC+3 (e.g. IST) when the UTC day rolls over after 03:00 local.
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const currentHour = now.getHours();
    if (currentHour >= 3 && last3AmRunDate !== todayStr) {
      last3AmRunDate = todayStr;
      log.info("scheduler", {
        msg: "triggering 3:00 AM local time Dream Cycle",
        date: todayStr,
        profile: activeProfile,
      });
      runDreamCycle(activeProfile).catch((err) => {
        log.error("scheduler", {
          msg: "3:00 AM Dream Cycle failed",
          profile: activeProfile,
          error: formatLogError(err),
        });
      });
    }
  } catch (err) {
    log.error("scheduler", {
      msg: "error checking 3:00 AM Dream Cycle",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }

  // Check 15 minutes of idle time Dream Cycle trigger
  try {
    if (
      typeof app !== "undefined" &&
      app.isReady() &&
      typeof powerMonitor !== "undefined" &&
      powerMonitor &&
      typeof powerMonitor.getSystemIdleTime === "function"
    ) {
      const idleTime = powerMonitor.getSystemIdleTime();
      const isIdleNow = idleTime >= 900; // 15 minutes
      if (isIdleNow && !wasIdle) {
        wasIdle = true;
        log.info("scheduler", {
          msg: "system idle threshold reached; triggering Dream Cycle",
          idleTimeSeconds: idleTime,
          profile: activeProfile,
        });
        runDreamCycle(activeProfile).catch((err) => {
          log.error("scheduler", {
            msg: "idle Dream Cycle failed",
            profile: activeProfile,
            error: formatLogError(err),
          });
        });
      } else if (!isIdleNow) {
        wasIdle = false;
      }
    }
  } catch (err) {
    log.error("scheduler", {
      msg: "error checking idle Dream Cycle",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }

  void maybeRunHermesAgentUpdateRoutine(new Date(), activeProfile).catch(
    (err) => {
      log.error("scheduler", {
        msg: "error checking Hermes Agent update",
        profile: activeProfile,
        error: formatLogError(err),
      });
    },
  );
  void maybeRunDesktopUpdateRoutine(new Date()).catch((err) => {
    log.error("scheduler", {
      msg: "error checking Desktop update",
      error: formatLogError(err),
    });
  });
  void maybeRunHermesUpstreamWatchRoutine(new Date(), activeProfile).catch(
    (err) => {
      log.error("scheduler", {
        msg: "error checking Hermes upstream watch",
        profile: activeProfile,
        error: formatLogError(err),
      });
    },
  );

  try {
    // The gateway runs its own 60s cron_tick() over the same jobs.json. When it
    // is alive it owns dispatch; dispatching from here too means two processes
    // race for every due job, and on app launch the whole overdue backlog fires
    // at once (observed 2026-07-24: 18 jobs in 250ms). The desktop tick stays as
    // the backstop for a down gateway; headless/cron-runner.ts covers app-closed.
    const engineOwnsDispatch = await engineCronTickerIsAlive(activeProfile);
    const now = Date.now();

    if (engineOwnsDispatch) {
      if (now - lastEngineDispatchLogMs >= ENGINE_DISPATCH_LOG_THROTTLE_MS) {
        lastEngineDispatchLogMs = now;
        log.info("scheduler", {
          msg: "engine cron ticker is live; deferring job dispatch",
          profile: activeProfile,
        });
      }
    } else {
      const jobs = await listCronJobs(true, activeProfile);

      for (const job of jobs) {
        if (
          !job.enabled ||
          job.state === "paused" ||
          job.state === "completed"
        ) {
          continue;
        }

        if (!job.next_run_at) {
          continue;
        }

        const nextRunTime = new Date(job.next_run_at).getTime();
        if (isNaN(nextRunTime)) {
          continue;
        }

        // Check if job is due and not currently running
        if (nextRunTime <= now && !activeRuns.has(job.id)) {
          log.info("scheduler", {
            msg: "triggering due job",
            jobId: job.id,
            jobName: job.name,
            profile: activeProfile,
          });
          runJobHeadless(job.id, job.name, activeProfile).catch((err) => {
            log.error("scheduler", {
              msg: "due job execution failed",
              jobId: job.id,
              jobName: job.name,
              profile: activeProfile,
              error: formatLogError(err),
            });
          });
        }
      }
    }
  } catch (err) {
    log.error("scheduler", {
      msg: "error during tick",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }

  void maybeRunAppLaunchSchedules(new Date(), activeProfile).catch((err) => {
    log.error("scheduler", {
      msg: "error checking app launch schedules",
      profile: activeProfile,
      error: formatLogError(err),
    });
  });

  try {
    await drainTaskProposalSpool(activeProfile);
  } catch (err) {
    log.error("task-proposal", {
      msg: "failed to drain inbound task proposals",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }

  try {
    await retryQueuedOwnerDeliveries(activeProfile);
  } catch (err) {
    log.error("owner-delivery", {
      msg: "failed to retry queued owner deliveries",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }

  // Nag engine: chase overdue human tasks (throttled to ~60s).
  try {
    const nagNow = Date.now();
    if (nagNow - lastNagTickMs >= NAG_TICK_THROTTLE_MS) {
      lastNagTickMs = nagNow;
      await nagTick(activeProfile);
    }
  } catch (err) {
    log.error("scheduler", {
      msg: "error during nag tick",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }

  // Email monitor: poll enabled IMAP accounts and capture triaged mail into the
  // vault (throttled to ~5m, and skipped entirely when nothing is configured).
  try {
    const emailNow = Date.now();
    const emailDue = emailNow - lastEmailTickMs >= EMAIL_TICK_THROTTLE_MS;
    // Reserve the config read (JSON parse) for when the throttle actually opens,
    // not every 10s tick.
    const hasActiveAccount =
      emailDue &&
      emailMonitorHasActiveAccount(getEmailMonitorConfig(activeProfile));
    if (hasActiveAccount) {
      lastEmailTickMs = emailNow;
      void runEmailMonitorNow(activeProfile).catch((err) => {
        log.error("scheduler", {
          msg: "error during email monitor run",
          profile: activeProfile,
          error: formatLogError(err),
        });
      });
    }
  } catch (err) {
    log.error("scheduler", {
      msg: "error checking email monitor",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }

  // Inbox digest: roll the day's triaged email captures into one digest row,
  // once per local calendar day at/after 17:00, only when email is configured.
  try {
    const digestNow = new Date();
    const digestDateStr = `${digestNow.getFullYear()}-${String(digestNow.getMonth() + 1).padStart(2, "0")}-${String(digestNow.getDate()).padStart(2, "0")}`;
    const digestDue =
      digestNow.getHours() >= INBOX_DIGEST_HOUR_LOCAL &&
      lastInboxDigestDate !== digestDateStr;
    if (
      digestDue &&
      emailMonitorHasActiveAccount(getEmailMonitorConfig(activeProfile))
    ) {
      lastInboxDigestDate = digestDateStr;
      void runInboxDigestNow(activeProfile).catch((err) => {
        log.error("scheduler", {
          msg: "error during inbox digest run",
          profile: activeProfile,
          error: formatLogError(err),
        });
      });
    }
  } catch (err) {
    log.error("scheduler", {
      msg: "error checking inbox digest",
      profile: activeProfile,
      error: formatLogError(err),
    });
  }
}

async function triageFailedJob(
  jobId: string,
  jobName: string,
  logFilePath: string,
  profile: string,
  errorInfo: string,
): Promise<void> {
  try {
    const jobs = await listCronJobs(true, profile);
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;

    let skillsContext = "";
    if (job.skills && job.skills.length > 0) {
      try {
        const installed = listInstalledSkills(profile);
        for (const skillName of job.skills) {
          const s = installed.find(
            (x) => x.name.toLowerCase() === skillName.toLowerCase(),
          );
          if (s) {
            const content = getSkillContent(s.path);
            skillsContext += `\n--- Skill: ${s.name} ---\n${content}\n`;
          }
        }
      } catch (skillErr) {
        log.error("scheduler", {
          msg: "triage error loading skills",
          jobId,
          jobName,
          profile,
          error: formatLogError(skillErr),
        });
      }
    }

    let logContent = "";
    try {
      if (existsSync(logFilePath)) {
        logContent = readFileSync(logFilePath, "utf-8");
      }
    } catch (logReadErr) {
      log.error("scheduler", {
        msg: "triage error reading log file",
        jobId,
        jobName,
        profile,
        logFilePath,
        error: formatLogError(logReadErr),
      });
    }

    const failureTriageSystemPrompt = `You are a site reliability and technical debugging assistant. A scheduled background routine/job in the Hermes workspace has failed.
You are given:
1. The job's metadata (name, prompt, script).
2. The associated skill content/code (if any).
3. The execution log output (stdout/stderr).

Analyze the logs and context to understand what caused the failure. Then, formulate a technical explanation of the failure formatted as a remedial study card (a Q&A flashcard or concept summary) suitable for the developer to study.
The remediation card body should explain:
- What failed (error message, command, or script step).
- Why it failed (the root cause, e.g., missing file, bad URL, API error, syntax issue).
- How to fix it (the concrete remediation step).

Your output must be a single, concise explanation representing the study card body. Keep it clear, professional, and educational. Use markdown formatting. Do not include any HTML, JSON, or formatting wrappers, just return the plain markdown content of the card.`;

    const url = `${getApiUrl(profile)}/v1/chat/completions`;
    const res = await gatewayFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getRemoteAuthHeader() },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: "hermes-agent",
        stream: false,
        messages: [
          { role: "system", content: failureTriageSystemPrompt },
          {
            role: "user",
            content: `Job Name: ${jobName}\nJob ID: ${jobId}\nJob Prompt: ${job.prompt || "N/A"}\nScript: ${job.script || "N/A"}\nAssociated Skills:\n${skillsContext || "None"}\nFailure Context: ${errorInfo}\n\nExecution Logs (Last 8000 characters):\n${logContent.slice(-8000)}`,
          },
        ],
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const cardBody = data?.choices?.[0]?.message?.content?.trim() || "";
      if (cardBody) {
        createLearningProposal(
          {
            kind: "memory",
            body: cardBody,
            reason: `Routine "${jobName}" execution failure (${errorInfo})`,
            source: { type: "repo", title: `Cron Failure: ${jobName}` },
          },
          profile,
        );
      }
    }
  } catch (err) {
    log.error("scheduler", {
      msg: "failure triage background task failed",
      jobId,
      jobName,
      profile,
      error: formatLogError(err),
    });
  }
}

/**
 * Headlessly run a specific cron job by ID.
 * Streams output to ~/.hermes/logs/routines/routine-<id>-<timestamp>.log
 */
export async function runJobHeadless(
  jobId: string,
  jobName: string,
  profile: string,
): Promise<boolean> {
  const connectionMode = getConnectionConfig().mode;
  if (connectionMode !== "local") {
    log.warn("scheduler", {
      msg: "skipping local cron runner outside local connection mode",
      jobId,
      jobName,
      profile,
      connectionMode,
    });
    return false;
  }
  if (activeRuns.has(jobId)) {
    log.warn("scheduler", {
      msg: "job is already running",
      jobId,
      jobName,
      profile,
    });
    return false;
  }

  const lockFile = lockPathFor(jobId);
  const existingLock = readExistingLock(lockFile);
  const decision = decideLockAcquisition(
    existingLock,
    Date.now(),
    JOB_TIMEOUT_MS,
    isPidAlive,
  );
  if (decision.type === "blocked") {
    recordSkip(jobId, "locked");
    log.warn("scheduler", {
      msg: "job is locked by a live runner; skipping",
      jobId,
      jobName,
      profile,
      lockFile,
      pid: existingLock?.pid,
    });
    return false;
  }
  if (decision.type === "steal") {
    log.warn("scheduler", {
      msg: "stealing lock",
      reason: decision.reason,
      jobId,
      jobName,
      prevPid: existingLock?.pid,
    });
  }

  try {
    mkdirSync(lockDir(), { recursive: true });
    const record: LockRecord = { pid: process.pid, startedAt: Date.now() };
    writeFileSync(lockFile, serializeLockRecord(record), "utf-8");
  } catch (err) {
    // Without a durable lock the cross-process / crash-recovery "at most one
    // runner" guarantee is gone. Skip this run rather than execute unguarded,
    // and surface it via skip telemetry so a persistent lock-dir problem is
    // visible instead of silently degrading to no protection.
    log.error("scheduler", {
      msg: "failed to create lockfile — skipping run to avoid an unguarded concurrent execution",
      jobId,
      jobName,
      profile,
      lockFile,
      error: formatLogError(err),
    });
    recordSkip(jobId, "lock-write-failed");
    return false;
  }

  // A clean acquisition means this job is healthy again — clear any stale skip
  // telemetry so the "keeps getting skipped" warning resolves on its own.
  clearSkip(jobId);

  activeRuns.set(jobId, true);
  const startTime = Date.now();

  const logDir = join(profileHome(profile), "logs", "routines");
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFilePath = join(logDir, `routine-${jobId}-${timestamp}.log`);
  let outcomeRun: ActiveWorkRun;
  try {
    outcomeRun = await createCronOutcomeRun(
      jobId,
      jobName,
      logFilePath,
      profile,
    );
  } catch (err) {
    activeRuns.delete(jobId);
    try {
      if (existsSync(lockFile)) unlinkSync(lockFile);
    } catch {
      // ignore
    }
    log.error("scheduler", {
      msg: "refusing to run an untracked cron job",
      jobId,
      jobName,
      profile,
      error: formatLogError(err),
    });
    return false;
  }

  return new Promise((resolve) => {
    try {
      const logStream = createWriteStream(logFilePath, { flags: "a" });

      logStream.write(
        `=== START ROUTINE RUN: "${jobName}" (${jobId}) at ${new Date().toISOString()} ===\n`,
      );
      logStream.write(`Profile: ${profile}\n\n`);

      const cliArgs = hermesCliArgs();
      if (profile && profile !== "default") {
        cliArgs.push("-p", profile);
      }
      cliArgs.push("cron", "run", jobId);

      const proc = spawn(HERMES_PYTHON, cliArgs, {
        cwd: join(HERMES_HOME, "hermes-agent"),
        env: {
          ...process.env,
          HERMES_HOME,
          HOME: homedir(),
          FAZM_HEADLESS: "1", // Indicate headless environment
        },
      });
      let runSettled = false;
      let outputAudit = "";

      const recordOutput = (chunk: unknown): void => {
        outputAudit = `${outputAudit}${String(chunk)}`.slice(
          -CRON_OUTPUT_AUDIT_LIMIT,
        );
      };

      proc.stdout.on("data", (chunk) => {
        if (!runSettled) {
          recordOutput(chunk);
          logStream.write(chunk);
        }
      });

      proc.stderr.on("data", (chunk) => {
        if (!runSettled) {
          recordOutput(chunk);
          logStream.write(chunk);
        }
      });

      // Reap a wedged run: if the child never exits within the timeout, kill it,
      // release the lock and resolve false. Without this a hung run would hold its
      // lock until the next acquisition's stale-steal — this bounds the damage and
      // frees the OS process. Cleared the moment the child exits normally.
      const reapTimer = setTimeout(() => {
        if (runSettled) return;
        runSettled = true;
        log.warn("scheduler", {
          msg: "reaping wedged job",
          jobId,
          jobName,
          timeoutMs: JOB_TIMEOUT_MS,
        });
        try {
          proc.kill("SIGKILL");
        } catch {
          // already gone
        }
        try {
          logStream.write(
            `\n=== REAPED: exceeded ${JOB_TIMEOUT_MS}ms timeout ===\n`,
          );
          logStream.end();
        } catch {
          // ignore
        }
        activeRuns.delete(jobId);
        try {
          if (existsSync(lockFile)) unlinkSync(lockFile);
        } catch {
          // ignore
        }
        recordSkip(jobId, "timeout-reaped");
        void settleCronOutcomeRun(
          outcomeRun,
          {
            status: "failed",
            error: `Scheduled job exceeded the ${JOB_TIMEOUT_MS} ms runtime limit.`,
          },
          profile,
        )
          .catch((err) => {
            log.error("scheduler", {
              msg: "failed to settle reaped cron outcome",
              jobId,
              profile,
              error: formatLogError(err),
            });
          })
          .finally(() => resolve(false));
      }, JOB_TIMEOUT_MS);
      reapTimer.unref?.();

      const handleProcessClose = async (code: number | null): Promise<void> => {
        if (runSettled) return;
        runSettled = true;
        clearTimeout(reapTimer);
        const duration = Date.now() - startTime;
        logStream.write(
          `\n=== END ROUTINE RUN: Exit Code ${code} (Duration: ${duration}ms) ===\n`,
        );
        logStream.end();
        activeRuns.delete(jobId);

        // Release lock
        try {
          if (existsSync(lockFile)) {
            unlinkSync(lockFile);
          }
        } catch {
          // ignore
        }

        log.info("scheduler", {
          msg: "job finished",
          jobId,
          jobName,
          profile,
          code,
          durationMs: duration,
        });

        const silentSuccess = code === 0 && outputAudit.includes("[SILENT]");
        if (code !== 0 || silentSuccess) {
          const failureReason = silentSuccess
            ? "The scheduled job returned [SILENT]; no deliverable was produced."
            : `Scheduled job exited with code ${code}.`;
          log.error("scheduler", {
            msg: "job failed; triggering Self-Healing Loop",
            jobId,
            jobName,
            profile,
            code,
            durationMs: duration,
          });
          try {
            await captureScreenshot(jobId, profile);
          } catch (captureErr) {
            log.error("scheduler", {
              msg: "error capturing screenshot",
              jobId,
              jobName,
              profile,
              error: formatLogError(captureErr),
            });
          }
          triageFailedJob(
            jobId,
            jobName,
            logFilePath,
            profile,
            failureReason,
          ).catch((err) => {
            log.error("scheduler", {
              msg: "failed-job triage failed",
              jobId,
              jobName,
              profile,
              error: formatLogError(err),
            });
          });
          triggerSelfHealing(jobId, jobName, logFilePath, profile).catch(
            (err) => {
              log.error("scheduler", {
                msg: "self-healing trigger failed",
                jobId,
                jobName,
                profile,
                error: formatLogError(err),
              });
            },
          );
          await settleCronOutcomeRun(
            outcomeRun,
            { status: "failed", error: failureReason },
            profile,
          );
          resolve(false);
        } else {
          await settleCronOutcomeRun(
            outcomeRun,
            {
              status: "completed",
              summary: `Scheduled job exited successfully in ${duration} ms; its transcript is preserved.`,
            },
            profile,
          );
          resolve(true);
        }
      };
      proc.on("close", (code) => {
        handleProcessClose(code).catch((err) => {
          log.error("scheduler", {
            msg: "job close handler failed",
            jobId,
            jobName,
            profile,
            error: formatLogError(err),
          });
          resolve(false);
        });
      });

      const handleProcessError = async (err: Error): Promise<void> => {
        if (runSettled) return;
        runSettled = true;
        clearTimeout(reapTimer);
        logStream.write(`\nProcess spawn error: ${err.message}\n`);
        logStream.end();
        activeRuns.delete(jobId);

        // Release lock
        try {
          if (existsSync(lockFile)) {
            unlinkSync(lockFile);
          }
        } catch {
          // ignore
        }

        log.error("scheduler", {
          msg: "spawn error running job",
          jobId,
          jobName,
          profile,
          error: formatLogError(err),
        });
        try {
          await captureScreenshot(jobId, profile);
        } catch (captureErr) {
          log.error("scheduler", {
            msg: "error capturing screenshot",
            jobId,
            jobName,
            profile,
            error: formatLogError(captureErr),
          });
        }
        triageFailedJob(
          jobId,
          jobName,
          logFilePath,
          profile,
          `Spawn Error: ${err.message}`,
        ).catch((triageError) => {
          log.error("scheduler", {
            msg: "spawn-error triage failed",
            jobId,
            jobName,
            profile,
            error: formatLogError(triageError),
          });
        });
        triggerSelfHealing(jobId, jobName, logFilePath, profile).catch(
          (healingError) => {
            log.error("scheduler", {
              msg: "spawn-error self-healing trigger failed",
              jobId,
              jobName,
              profile,
              error: formatLogError(healingError),
            });
          },
        );
        await settleCronOutcomeRun(
          outcomeRun,
          { status: "failed", error: `Process spawn failed: ${err.message}` },
          profile,
        );
        resolve(false);
      };
      proc.on("error", (err) => {
        handleProcessError(err).catch((handlerError) => {
          log.error("scheduler", {
            msg: "job error handler failed",
            jobId,
            jobName,
            profile,
            error: formatLogError(handlerError),
          });
          resolve(false);
        });
      });
    } catch (err) {
      activeRuns.delete(jobId);

      // Release lock
      try {
        if (existsSync(lockFile)) {
          unlinkSync(lockFile);
        }
      } catch {
        // ignore
      }

      log.error("scheduler", {
        msg: "failed to run job headlessly",
        jobId,
        jobName,
        profile,
        error: formatLogError(err),
      });
      void settleCronOutcomeRun(
        outcomeRun,
        {
          status: "failed",
          error: `Scheduled job setup failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        profile,
      )
        .catch((settleError) => {
          log.error("scheduler", {
            msg: "failed to settle cron setup error",
            jobId,
            profile,
            error: formatLogError(settleError),
          });
        })
        .finally(() => resolve(false));
    }
  });
}

/**
 * Start the background scheduler timer.
 */
export function startScheduler(config: Partial<SchedulerConfig> = {}): void {
  const currentConfig = getSchedulerConfig();
  const merged = { ...currentConfig, ...config };
  if (!merged.enabled) {
    log.info("scheduler", { msg: "scheduler is disabled by configuration" });
    return;
  }

  if (schedulerInterval) {
    log.warn("scheduler", { msg: "scheduler is already running" });
    return;
  }

  log.info("scheduler", {
    msg: "starting background scheduler",
    tickIntervalMs: merged.tickIntervalMs,
  });
  schedulerInterval = setInterval(() => {
    tickScheduler().catch((err) => {
      log.error("scheduler", {
        msg: "scheduler tick failed",
        error: formatLogError(err),
      });
    });
  }, merged.tickIntervalMs);
}

/**
 * Stop the background scheduler timer.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    log.info("scheduler", { msg: "stopping background scheduler" });
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
