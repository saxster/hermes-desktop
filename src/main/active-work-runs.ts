import { promises as fs } from "fs";
import { join } from "path";
import {
  profileHome,
  getActiveProfileNameSync,
  safeWriteFileAsync,
} from "./utils";
import type {
  ActiveWorkCreateInput,
  ActiveWorkCriterion,
  ActiveWorkExpectedArtifact,
  ActiveWorkPatch,
  ActiveWorkRun,
} from "../shared/active-work";
import {
  ACTIVE_WORK_CONTRACT_VERSION,
  activeWorkCanComplete,
  activeWorkCreateInputErrors,
  activeWorkPatchErrors,
} from "../shared/active-work";
import { createHumanAttentionItem } from "./human-attention";
import { getHermesRunResumeSnapshot } from "./run-event-store";
import { revokeRunAutonomyGrants } from "./autonomy-grants";

const writeQueues = new Map<string, Promise<void>>();
const processStartedAt = Date.now();
const reconciledProfiles = new Set<string>();

function activeWorkPath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "active-work-runs.json",
  );
}

function id(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCriteria(
  criteria: ActiveWorkCreateInput["criteria"] = [],
): ActiveWorkCriterion[] {
  const declared = criteria.length
    ? criteria
    : [{ text: "Produce a reviewable result", done: false }];
  return declared.map((c) => ({
    id: id("crit"),
    text: c.text,
    done: Boolean(c.done),
  }));
}

function normalizeExpectedArtifacts(
  expected: ActiveWorkExpectedArtifact[] | undefined,
): ActiveWorkExpectedArtifact[] {
  return expected?.length
    ? expected.map((artifact) => ({ ...artifact }))
    : [{ kind: "text", label: "Result", required: true }];
}

function normalizeStoredRun(raw: ActiveWorkRun): ActiveWorkRun {
  if (!raw || typeof raw !== "object")
    throw new Error("stored run is not an object");
  const normalized: ActiveWorkRun = {
    ...raw,
    contractVersion: ACTIVE_WORK_CONTRACT_VERSION,
    trigger: raw.trigger ?? "manual",
    reviewPolicy: raw.reviewPolicy ?? "review-first",
    attempt: Number.isInteger(raw.attempt) && raw.attempt > 0 ? raw.attempt : 1,
    criteria: Array.isArray(raw.criteria) ? raw.criteria : [],
    expectedArtifacts: Array.isArray(raw.expectedArtifacts)
      ? raw.expectedArtifacts
      : [],
    artifacts: Array.isArray(raw.artifacts) ? raw.artifacts : [],
  };
  const createErrors = activeWorkCreateInputErrors({
    source: normalized.source,
    trigger: normalized.trigger,
    reviewPolicy: normalized.reviewPolicy,
    title: normalized.title,
    goal: normalized.goal,
    pageId: normalized.pageId,
    pageTitle: normalized.pageTitle,
    sessionId: normalized.sessionId,
    clientRunId: normalized.clientRunId,
    taskId: normalized.taskId,
    criteria: normalized.criteria.map((criterion) => ({
      text: criterion.text,
      done: criterion.done,
    })),
    expectedArtifacts: normalized.expectedArtifacts,
  });
  const patchErrors = activeWorkPatchErrors({
    status: normalized.status,
    sessionId: normalized.sessionId,
    clientRunId: normalized.clientRunId,
    taskId: normalized.taskId,
    criteria: normalized.criteria,
    expectedArtifacts: normalized.expectedArtifacts,
    artifacts: normalized.artifacts,
    lastTool: normalized.lastTool,
    lastHeartbeatAt: normalized.lastHeartbeatAt,
    blockerReason: normalized.blockerReason,
    summary: normalized.summary,
    error: normalized.error,
    attentionItemId: normalized.attentionItemId,
    attempt: normalized.attempt,
    completedAt: normalized.completedAt,
  });
  if (
    !normalized.id ||
    typeof normalized.id !== "string" ||
    !Number.isFinite(normalized.createdAt) ||
    !Number.isFinite(normalized.updatedAt) ||
    createErrors.length ||
    patchErrors.length
  ) {
    throw new Error(
      `stored run is invalid: ${[...createErrors, ...patchErrors].join("; ")}`,
    );
  }
  return normalized;
}

async function readRuns(profile?: string): Promise<ActiveWorkRun[]> {
  try {
    const raw = await fs.readFile(activeWorkPath(profile), "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("store root is not an array");
    return (parsed as ActiveWorkRun[]).map(normalizeStoredRun);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `Active work tracking could not be read: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

async function writeRuns(
  runs: ActiveWorkRun[],
  profile?: string,
): Promise<void> {
  const p = activeWorkPath(profile);
  await safeWriteFileAsync(p, JSON.stringify(runs, null, 2));
}

async function mutate<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const queued = previous.then(operation, operation);
  const tail = queued.then(
    () => undefined,
    () => undefined,
  );
  writeQueues.set(path, tail);
  try {
    return await queued;
  } finally {
    if (writeQueues.get(path) === tail) writeQueues.delete(path);
  }
}

export async function listActiveWorkRuns(
  profile?: string,
): Promise<ActiveWorkRun[]> {
  const path = activeWorkPath(profile);
  if (!reconciledProfiles.has(path)) {
    await reconcileInterruptedActiveWorkRuns(profile, processStartedAt);
    reconciledProfiles.add(path);
  }
  await reconcileActiveWorkAttention(profile);
  const runs = await readRuns(profile);
  return runs.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function reconcileActiveWorkAttention(profile?: string): Promise<void> {
  const runs = await readRuns(profile);
  for (const run of runs) {
    if (run.status !== "blocked" && run.status !== "failed") continue;
    try {
      const kind = run.status === "blocked" ? "blocked-run" : "failed-run";
      const reason =
        run.blockerReason || run.error || `${run.title} needs review.`;
      const item = await createHumanAttentionItem(
        {
          kind,
          source: "active-work",
          title:
            run.status === "blocked"
              ? `${run.title} is blocked`
              : `${run.title} failed`,
          summary: reason,
          idempotencyKey: `active-work:${run.id}:${run.status}:${run.attempt}`,
          runId: run.id,
          sessionId: run.sessionId,
          choices: [
            { id: "review-run", label: "Review run", tone: "primary" },
            { id: "dismiss", label: "Dismiss" },
          ],
          resume: { kind: "active-work", ref: run.id },
        },
        profile,
      );
      if (run.attentionItemId !== item.id) {
        await updateActiveWorkRun(
          run.id,
          { attentionItemId: item.id },
          profile,
        );
      }
    } catch {
      // Active Work remains the primary durable record. Retry on the next list.
    }
  }
}

export async function getActiveWorkRun(
  runId: string,
  profile?: string,
): Promise<ActiveWorkRun | null> {
  const runs = await readRuns(profile);
  return runs.find((r) => r.id === runId) ?? null;
}

export async function createActiveWorkRun(
  input: ActiveWorkCreateInput,
  profile?: string,
): Promise<ActiveWorkRun> {
  const inputErrors = activeWorkCreateInputErrors(input);
  if (inputErrors.length) {
    throw new Error(`Invalid active work input: ${inputErrors.join("; ")}`);
  }
  const path = activeWorkPath(profile);
  return mutate(path, async () => {
    const runs = await readRuns(profile);
    if (input.clientRunId) {
      const existing = runs.find(
        (run) => run.clientRunId === input.clientRunId,
      );
      if (existing) return existing;
    }
    const now = Date.now();
    const run: ActiveWorkRun = {
      contractVersion: ACTIVE_WORK_CONTRACT_VERSION,
      id: id("work"),
      source: input.source,
      trigger: input.trigger ?? "manual",
      reviewPolicy: input.reviewPolicy ?? "review-first",
      attempt: 1,
      status: "running",
      title: input.title,
      goal: input.goal,
      pageId: input.pageId,
      pageTitle: input.pageTitle,
      sessionId: input.sessionId,
      clientRunId: input.clientRunId,
      taskId: input.taskId,
      criteria: normalizeCriteria(input.criteria),
      expectedArtifacts: normalizeExpectedArtifacts(input.expectedArtifacts),
      artifacts: [],
      createdAt: now,
      updatedAt: now,
    };
    await writeRuns([run, ...runs], profile);
    return run;
  });
}

export async function updateActiveWorkRun(
  runId: string,
  patch: ActiveWorkPatch,
  profile?: string,
): Promise<ActiveWorkRun | null> {
  const patchErrors = activeWorkPatchErrors(patch);
  if (patchErrors.length) {
    throw new Error(`Invalid active work patch: ${patchErrors.join("; ")}`);
  }
  const path = activeWorkPath(profile);
  return mutate(path, async () => {
    const runs = await readRuns(profile);
    const idx = runs.findIndex((r) => r.id === runId);
    if (idx < 0) return null;
    const current = runs[idx];
    const next: ActiveWorkRun = {
      ...current,
      status: patch.status ?? current.status,
      sessionId: patch.sessionId ?? current.sessionId,
      clientRunId: patch.clientRunId ?? current.clientRunId,
      taskId: patch.taskId ?? current.taskId,
      criteria: patch.criteria ?? current.criteria,
      expectedArtifacts: patch.expectedArtifacts ?? current.expectedArtifacts,
      artifacts: patch.artifacts ?? current.artifacts,
      lastTool:
        patch.lastTool === null
          ? undefined
          : (patch.lastTool ?? current.lastTool),
      blockerReason:
        patch.blockerReason === null
          ? undefined
          : (patch.blockerReason ?? current.blockerReason),
      summary:
        patch.summary === null ? undefined : (patch.summary ?? current.summary),
      error: patch.error === null ? undefined : (patch.error ?? current.error),
      attentionItemId:
        patch.attentionItemId === null
          ? undefined
          : (patch.attentionItemId ?? current.attentionItemId),
      lastHeartbeatAt: patch.lastHeartbeatAt ?? current.lastHeartbeatAt,
      attempt: patch.attempt ?? current.attempt,
      completedAt: patch.completedAt ?? current.completedAt,
      updatedAt: Date.now(),
    };
    if (next.status === "completed" && !activeWorkCanComplete(next)) {
      throw new Error(
        "Active work cannot be completed until every criterion has evidence and every required artifact exists.",
      );
    }
    runs[idx] = next;
    await writeRuns(runs, profile);

    if (
      current.status !== next.status &&
      (next.status === "completed" ||
        next.status === "failed" ||
        next.status === "stopped")
    ) {
      try {
        revokeRunAutonomyGrants(next.id, profile);
        if (next.clientRunId && next.clientRunId !== next.id) {
          revokeRunAutonomyGrants(next.clientRunId, profile);
        }
      } catch {
        // A terminal run remains terminal even if secondary grant cleanup needs
        // later operator attention. Expiry still bounds every grant.
      }
    }

    if (
      (next.status === "blocked" || next.status === "failed") &&
      current.status !== next.status
    ) {
      const kind = next.status === "blocked" ? "blocked-run" : "failed-run";
      const reason =
        next.blockerReason || next.error || `${next.title} needs review.`;
      try {
        const item = await createHumanAttentionItem(
          {
            kind,
            source: "active-work",
            title:
              next.status === "blocked"
                ? `${next.title} is blocked`
                : `${next.title} failed`,
            summary: reason,
            idempotencyKey: `active-work:${next.id}:${next.status}:${next.attempt}`,
            runId: next.id,
            sessionId: next.sessionId,
            choices: [
              { id: "review-run", label: "Review run", tone: "primary" },
              { id: "dismiss", label: "Dismiss" },
            ],
            resume: { kind: "active-work", ref: next.id },
          },
          profile,
        );
        next.attentionItemId = item.id;
        runs[idx] = next;
        await writeRuns(runs, profile);
      } catch {
        // The failed/blocked run remains durable and visible even if the secondary
        // attention index cannot be updated. listActiveWorkRuns re-parks it.
      }
    }
    return next;
  });
}

export async function reconcileInterruptedActiveWorkRuns(
  profile?: string,
  interruptedBefore = processStartedAt,
): Promise<ActiveWorkRun[]> {
  const running = (await readRuns(profile)).filter(
    (run) => run.status === "running" && run.updatedAt < interruptedBefore,
  );
  const reconciled: ActiveWorkRun[] = [];
  for (const run of running) {
    const snapshot = run.clientRunId
      ? getHermesRunResumeSnapshot(run.clientRunId, profile)
      : null;
    if (snapshot?.status === "stopped") {
      const stopped = await updateActiveWorkRun(
        run.id,
        {
          status: "stopped",
          completedAt: Date.now(),
          lastTool: null,
        },
        profile,
      );
      if (stopped) reconciled.push(stopped);
      continue;
    }
    if (snapshot?.status === "failed") {
      const failed = await updateActiveWorkRun(
        run.id,
        {
          status: "failed",
          error: "Hermes recorded a failure before the desktop restarted.",
          completedAt: Date.now(),
          lastTool: null,
        },
        profile,
      );
      if (failed) reconciled.push(failed);
      continue;
    }
    const reason =
      snapshot?.status === "completed"
        ? "Hermes completed before restart, but its deliverables still require reconciliation and review."
        : snapshot?.status === "waiting-attention"
          ? "Hermes was waiting for approval when the desktop restarted; live upstream continuation is unverified."
          : "The desktop restarted before this run recorded a terminal result; verify its upstream state before retrying.";
    const blocked = await updateActiveWorkRun(
      run.id,
      {
        status: "blocked",
        blockerReason: reason,
        sessionId: snapshot?.sessionId ?? run.sessionId,
        lastTool: null,
      },
      profile,
    );
    if (blocked) reconciled.push(blocked);
  }
  return reconciled;
}
