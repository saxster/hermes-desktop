export type ActiveWorkStatus =
  | "running"
  | "paused"
  | "blocked"
  | "awaiting-review"
  | "completed"
  | "stopped"
  | "failed";

export const ACTIVE_WORK_CONTRACT_VERSION = 2 as const;

export type ActiveWorkSource =
  | "sps-work"
  | "goal"
  | "kanban"
  | "cron-job"
  | "assistant-recipe"
  | "scheduled-research"
  | "proposal-triggered";

export type ActiveWorkTrigger =
  | "manual"
  | "scheduled"
  | "cron"
  | "proposal"
  | "external";

export type ActiveWorkReviewPolicy = "review-first" | "auto-apply";

export interface ActiveWorkCriterionEvidence {
  summary: string;
  artifactId?: string;
  verifiedAt: number;
  verifiedBy: "agent" | "user" | "system";
}

export interface ActiveWorkCriterion {
  id: string;
  text: string;
  done: boolean;
  evidence?: ActiveWorkCriterionEvidence;
}

export type ActiveWorkArtifactKind =
  | "page"
  | "session"
  | "task"
  | "file"
  | "text"
  | "proposal"
  | "receipt"
  | "transcript"
  | "url";

export interface ActiveWorkArtifact {
  id: string;
  kind: ActiveWorkArtifactKind;
  label: string;
  ref?: string;
  createdAt: number;
}

export interface ActiveWorkExpectedArtifact {
  kind: ActiveWorkArtifactKind;
  label: string;
  required: boolean;
}

export interface ActiveWorkRun {
  contractVersion: typeof ACTIVE_WORK_CONTRACT_VERSION;
  id: string;
  source: ActiveWorkSource;
  trigger: ActiveWorkTrigger;
  reviewPolicy: ActiveWorkReviewPolicy;
  attempt: number;
  status: ActiveWorkStatus;
  title: string;
  goal: string;
  pageId?: string;
  pageTitle?: string;
  sessionId?: string;
  clientRunId?: string;
  taskId?: string;
  criteria: ActiveWorkCriterion[];
  expectedArtifacts: ActiveWorkExpectedArtifact[];
  artifacts: ActiveWorkArtifact[];
  lastTool?: string;
  lastHeartbeatAt?: number;
  blockerReason?: string;
  summary?: string;
  error?: string;
  attentionItemId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ActiveWorkCreateInput {
  source: ActiveWorkSource;
  trigger?: ActiveWorkTrigger;
  reviewPolicy?: ActiveWorkReviewPolicy;
  title: string;
  goal: string;
  pageId?: string;
  pageTitle?: string;
  sessionId?: string;
  clientRunId?: string;
  taskId?: string;
  criteria?: Array<{ text: string; done?: boolean }>;
  expectedArtifacts?: ActiveWorkExpectedArtifact[];
}

export interface ActiveWorkPatch {
  status?: ActiveWorkStatus;
  sessionId?: string;
  clientRunId?: string;
  taskId?: string;
  criteria?: ActiveWorkCriterion[];
  expectedArtifacts?: ActiveWorkExpectedArtifact[];
  artifacts?: ActiveWorkArtifact[];
  lastTool?: string | null;
  lastHeartbeatAt?: number;
  blockerReason?: string | null;
  summary?: string | null;
  error?: string | null;
  attentionItemId?: string | null;
  attempt?: number;
  completedAt?: number;
}

export function activeWorkCanComplete(run: ActiveWorkRun): boolean {
  if (run.criteria.length === 0 || run.artifacts.length === 0) return false;
  if (
    run.criteria.some((criterion) => !criterion.done || !criterion.evidence)
  ) {
    return false;
  }
  if (
    run.criteria.some(
      (criterion) =>
        criterion.evidence?.artifactId !== undefined &&
        !run.artifacts.some(
          (artifact) => artifact.id === criterion.evidence?.artifactId,
        ),
    )
  ) {
    return false;
  }
  return run.expectedArtifacts
    .filter((expected) => expected.required)
    .every((expected) =>
      run.artifacts.some((artifact) => artifact.kind === expected.kind),
    );
}

const ACTIVE_WORK_SOURCES = new Set<ActiveWorkSource>([
  "sps-work",
  "goal",
  "kanban",
  "cron-job",
  "assistant-recipe",
  "scheduled-research",
  "proposal-triggered",
]);
const ACTIVE_WORK_TRIGGERS = new Set<ActiveWorkTrigger>([
  "manual",
  "scheduled",
  "cron",
  "proposal",
  "external",
]);
const ACTIVE_WORK_STATUSES = new Set<ActiveWorkStatus>([
  "running",
  "paused",
  "blocked",
  "awaiting-review",
  "completed",
  "stopped",
  "failed",
]);
const ACTIVE_WORK_ARTIFACT_KINDS = new Set<ActiveWorkArtifactKind>([
  "page",
  "session",
  "task",
  "file",
  "text",
  "proposal",
  "receipt",
  "transcript",
  "url",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown, max: number): boolean {
  return typeof value === "string" && !!value.trim() && value.length <= max;
}

function artifactErrors(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label} must be an object`];
  const errors: string[] = [];
  if (!ACTIVE_WORK_ARTIFACT_KINDS.has(value.kind as ActiveWorkArtifactKind)) {
    errors.push(`${label}.kind is unsupported`);
  }
  if (!validText(value.label, 500)) errors.push(`${label}.label is invalid`);
  if (
    value.ref !== undefined &&
    (typeof value.ref !== "string" || value.ref.length > 5_000)
  ) {
    errors.push(`${label}.ref is invalid`);
  }
  return errors;
}

const CREATE_KEYS = new Set([
  "source",
  "trigger",
  "reviewPolicy",
  "title",
  "goal",
  "pageId",
  "pageTitle",
  "sessionId",
  "clientRunId",
  "taskId",
  "criteria",
  "expectedArtifacts",
]);

const PATCH_KEYS = new Set([
  "status",
  "sessionId",
  "clientRunId",
  "taskId",
  "criteria",
  "expectedArtifacts",
  "artifacts",
  "lastTool",
  "lastHeartbeatAt",
  "blockerReason",
  "summary",
  "error",
  "attentionItemId",
  "attempt",
  "completedAt",
]);

function optionalTextError(
  value: unknown,
  label: string,
  max: number,
  nullable = false,
): string | null {
  if (value === undefined || (nullable && value === null)) return null;
  return typeof value === "string" && value.length <= max
    ? null
    : `${label} is invalid`;
}

function optionalTimestampError(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? null
    : `${label} must be a finite non-negative timestamp`;
}

export function activeWorkCreateInputErrors(raw: unknown): string[] {
  if (!isRecord(raw)) return ["input must be an object"];
  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!CREATE_KEYS.has(key)) errors.push(`${key} is not supported`);
  }
  if (!ACTIVE_WORK_SOURCES.has(raw.source as ActiveWorkSource)) {
    errors.push("source is unsupported");
  }
  if (
    raw.trigger !== undefined &&
    !ACTIVE_WORK_TRIGGERS.has(raw.trigger as ActiveWorkTrigger)
  ) {
    errors.push("trigger is unsupported");
  }
  if (
    raw.reviewPolicy !== undefined &&
    raw.reviewPolicy !== "review-first" &&
    raw.reviewPolicy !== "auto-apply"
  ) {
    errors.push("reviewPolicy is unsupported");
  }
  if (!validText(raw.title, 500)) errors.push("title is invalid");
  if (!validText(raw.goal, 5_000)) errors.push("goal is invalid");
  for (const [key, max] of [
    ["pageId", 500],
    ["pageTitle", 500],
    ["sessionId", 500],
    ["clientRunId", 500],
    ["taskId", 500],
  ] as const) {
    const error = optionalTextError(raw[key], key, max);
    if (error) errors.push(error);
  }
  if (raw.criteria !== undefined) {
    if (!Array.isArray(raw.criteria) || raw.criteria.length > 100) {
      errors.push("criteria must be an array with at most 100 entries");
    } else {
      raw.criteria.forEach((criterion, index) => {
        if (!isRecord(criterion) || !validText(criterion.text, 2_000)) {
          errors.push(`criteria[${index}] is invalid`);
        }
        if (
          isRecord(criterion) &&
          criterion.done !== undefined &&
          typeof criterion.done !== "boolean"
        ) {
          errors.push(`criteria[${index}].done must be boolean`);
        }
      });
    }
  }
  if (raw.expectedArtifacts !== undefined) {
    if (
      !Array.isArray(raw.expectedArtifacts) ||
      raw.expectedArtifacts.length > 100
    ) {
      errors.push(
        "expectedArtifacts must be an array with at most 100 entries",
      );
    } else {
      raw.expectedArtifacts.forEach((artifact, index) => {
        errors.push(...artifactErrors(artifact, `expectedArtifacts[${index}]`));
        if (isRecord(artifact) && typeof artifact.required !== "boolean") {
          errors.push(`expectedArtifacts[${index}].required must be boolean`);
        }
      });
    }
  }
  return errors;
}

export function activeWorkPatchErrors(raw: unknown): string[] {
  if (!isRecord(raw)) return ["patch must be an object"];
  const errors: string[] = [];
  for (const key of Object.keys(raw)) {
    if (!PATCH_KEYS.has(key)) errors.push(`${key} is not supported`);
  }
  if (
    raw.status !== undefined &&
    !ACTIVE_WORK_STATUSES.has(raw.status as ActiveWorkStatus)
  ) {
    errors.push("status is unsupported");
  }
  if (
    raw.attempt !== undefined &&
    (!Number.isInteger(raw.attempt) || Number(raw.attempt) < 1)
  ) {
    errors.push("attempt must be a positive integer");
  }
  for (const [key, max, nullable] of [
    ["sessionId", 500, false],
    ["clientRunId", 500, false],
    ["taskId", 500, false],
    ["lastTool", 500, true],
    ["blockerReason", 5_000, true],
    ["summary", 5_000, true],
    ["error", 5_000, true],
    ["attentionItemId", 500, true],
  ] as const) {
    const error = optionalTextError(raw[key], key, max, nullable);
    if (error) errors.push(error);
  }
  for (const key of ["lastHeartbeatAt", "completedAt"] as const) {
    const error = optionalTimestampError(raw[key], key);
    if (error) errors.push(error);
  }
  if (raw.criteria !== undefined) {
    if (!Array.isArray(raw.criteria) || raw.criteria.length > 100) {
      errors.push("criteria must be an array with at most 100 entries");
    } else {
      raw.criteria.forEach((criterion, index) => {
        if (
          !isRecord(criterion) ||
          !validText(criterion.id, 200) ||
          !validText(criterion.text, 2_000) ||
          typeof criterion.done !== "boolean"
        ) {
          errors.push(`criteria[${index}] is invalid`);
        }
        if (isRecord(criterion) && criterion.evidence !== undefined) {
          const evidence = criterion.evidence;
          if (
            !isRecord(evidence) ||
            !validText(evidence.summary, 2_000) ||
            !Number.isFinite(evidence.verifiedAt) ||
            !["agent", "user", "system"].includes(String(evidence.verifiedBy))
          ) {
            errors.push(`criteria[${index}].evidence is invalid`);
          }
          if (
            isRecord(evidence) &&
            evidence.artifactId !== undefined &&
            !validText(evidence.artifactId, 200)
          ) {
            errors.push(`criteria[${index}].evidence.artifactId is invalid`);
          }
        }
      });
    }
  }
  if (raw.expectedArtifacts !== undefined) {
    if (
      !Array.isArray(raw.expectedArtifacts) ||
      raw.expectedArtifacts.length > 100
    ) {
      errors.push(
        "expectedArtifacts must be an array with at most 100 entries",
      );
    } else {
      raw.expectedArtifacts.forEach((artifact, index) => {
        errors.push(...artifactErrors(artifact, `expectedArtifacts[${index}]`));
        if (isRecord(artifact) && typeof artifact.required !== "boolean") {
          errors.push(`expectedArtifacts[${index}].required must be boolean`);
        }
      });
    }
  }
  if (raw.artifacts !== undefined) {
    if (!Array.isArray(raw.artifacts) || raw.artifacts.length > 200) {
      errors.push("artifacts must be an array with at most 200 entries");
    } else {
      raw.artifacts.forEach((artifact, index) => {
        errors.push(...artifactErrors(artifact, `artifacts[${index}]`));
        if (
          !isRecord(artifact) ||
          !validText(artifact.id, 200) ||
          !Number.isFinite(artifact.createdAt) ||
          Number(artifact.createdAt) < 0
        ) {
          errors.push(`artifacts[${index}] identity is invalid`);
        }
      });
    }
  }
  return errors;
}
