import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";
import { redactLedgerText } from "../shared/action-receipts";
import {
  HUMAN_ATTENTION_CONTRACT_VERSION,
  type HumanAttentionChoice,
  type HumanAttentionCounts,
  type HumanAttentionCreateInput,
  type HumanAttentionItem,
  type HumanAttentionKind,
  type HumanAttentionListOptions,
  type HumanAttentionResolveInput,
  type HumanAttentionResolveResult,
  type HumanAttentionStatus,
} from "../shared/human-attention";
import { buildHermesRunResumeSnapshot } from "../shared/run-events";
import { listAllHermesRunEvents } from "./run-event-store";
import {
  getActiveProfileNameSync,
  profileHome,
  safeWriteFileAsync,
} from "./utils";

const STORE_FILE = "human-attention.json";
const MAX_ITEMS = 2_000;
const writeQueues = new Map<string, Promise<void>>();

const KINDS = new Set<HumanAttentionKind>([
  "approval",
  "question",
  "blocked-run",
  "failed-run",
  "notification",
  "workspace-proposal",
]);

const STATUSES = new Set<HumanAttentionStatus>([
  "pending",
  "resolved",
  "dismissed",
  "expired",
]);
const CHOICE_TONES = new Set(["default", "primary", "danger"]);
const RESUME_KINDS = new Set([
  "active-work",
  "assistant-recipe",
  "scheduled-research",
  "chat",
]);
const RESOLVED_BY = new Set(["desktop", "automation", "system"]);

function normalizedProfile(profile?: string): string {
  return (
    (profile || getActiveProfileNameSync() || "default").trim() || "default"
  );
}

function storePath(profile?: string): string {
  return join(profileHome(normalizedProfile(profile)), "sps-agent", STORE_FILE);
}

function makeId(): string {
  return `attention_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

function cleanRequired(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label} is required.`);
  }
  const clean = redactLedgerText(value);
  if (!clean || clean === "(no summary)")
    throw new Error(`${label} is required.`);
  return clean;
}

function cleanOptional(
  value: unknown,
  label: string,
  max = 160,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`${label} is invalid.`);
  }
  if (!value.trim()) return undefined;
  return redactLedgerText(value);
}

function normalizeChoices(
  input: HumanAttentionChoice[] | undefined,
): HumanAttentionChoice[] {
  const choices = input?.length
    ? input
    : [{ id: "acknowledge", label: "Acknowledge" }];
  if (choices.length > 8)
    throw new Error("Attention items may declare at most 8 choices.");
  const seen = new Set<string>();
  return choices.slice(0, 8).map((choice) => {
    const id = cleanRequired(choice?.id, "Choice id", 64);
    if (seen.has(id)) throw new Error(`Duplicate attention choice: ${id}`);
    if (choice.tone !== undefined && !CHOICE_TONES.has(choice.tone)) {
      throw new Error(`Unsupported attention choice tone: ${choice.tone}`);
    }
    seen.add(id);
    return {
      id,
      label: cleanRequired(choice?.label, "Choice label", 80),
      ...(choice.tone ? { tone: choice.tone } : {}),
    };
  });
}

function normalizeCreateInput(
  input: HumanAttentionCreateInput,
  profile: string,
  now: number,
): HumanAttentionItem {
  if (!input || typeof input !== "object")
    throw new Error("Attention item is required.");
  if (!KINDS.has(input.kind))
    throw new Error("Unsupported attention item kind.");
  if (
    input.expiresAt !== undefined &&
    (!Number.isFinite(input.expiresAt) || input.expiresAt <= now)
  ) {
    throw new Error("Attention expiry must be in the future.");
  }
  const resume = input.resume
    ? {
        kind: input.resume.kind,
        ref: cleanRequired(input.resume.ref, "Resume reference", 160),
      }
    : undefined;
  if (resume && !RESUME_KINDS.has(resume.kind)) {
    throw new Error("Unsupported attention resume kind.");
  }
  return {
    contractVersion: HUMAN_ATTENTION_CONTRACT_VERSION,
    id: makeId(),
    profile,
    kind: input.kind,
    status: "pending",
    source: cleanRequired(input.source, "Attention source", 80),
    title: cleanRequired(input.title, "Attention title", 160),
    summary: cleanRequired(input.summary, "Attention summary", 180),
    idempotencyKey: cleanRequired(input.idempotencyKey, "Idempotency key", 180),
    runId: cleanOptional(input.runId, "Run id"),
    sessionId: cleanOptional(input.sessionId, "Session id"),
    requestId: cleanOptional(input.requestId, "Request id"),
    toolCallId: cleanOptional(input.toolCallId, "Tool call id"),
    proposalId: cleanOptional(input.proposalId, "Proposal id"),
    choices: normalizeChoices(input.choices),
    resume,
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
  };
}

function isStoredItem(value: unknown): value is HumanAttentionItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<HumanAttentionItem>;
  return (
    item.contractVersion === HUMAN_ATTENTION_CONTRACT_VERSION &&
    typeof item.id === "string" &&
    typeof item.profile === "string" &&
    typeof item.kind === "string" &&
    KINDS.has(item.kind as HumanAttentionKind) &&
    typeof item.status === "string" &&
    STATUSES.has(item.status as HumanAttentionStatus) &&
    typeof item.source === "string" &&
    typeof item.title === "string" &&
    typeof item.summary === "string" &&
    typeof item.idempotencyKey === "string" &&
    Array.isArray(item.choices) &&
    item.choices.length > 0 &&
    item.choices.length <= 8 &&
    item.choices.every(
      (choice) =>
        choice &&
        typeof choice.id === "string" &&
        typeof choice.label === "string" &&
        (choice.tone === undefined || CHOICE_TONES.has(choice.tone)),
    ) &&
    (item.resume === undefined ||
      (RESUME_KINDS.has(item.resume.kind) &&
        typeof item.resume.ref === "string")) &&
    (item.resolution === undefined ||
      (typeof item.resolution.choiceId === "string" &&
        typeof item.resolution.resolvedAt === "number" &&
        RESOLVED_BY.has(item.resolution.resolvedBy))) &&
    typeof item.createdAt === "number" &&
    typeof item.updatedAt === "number"
  );
}

async function readItems(path: string): Promise<HumanAttentionItem[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("store root is not an array");
    if (!parsed.every(isStoredItem))
      throw new Error("store contains an invalid attention item");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `Needs Attention could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function writeItems(
  path: string,
  items: HumanAttentionItem[],
): Promise<void> {
  const pending = items.filter((item) => item.status === "pending");
  if (pending.length > MAX_ITEMS) {
    throw new Error(
      "Needs Attention is full of unresolved items; resolve an item before adding another.",
    );
  }
  const resolvedAllowance = MAX_ITEMS - pending.length;
  const keepResolved = new Set(
    resolvedAllowance > 0
      ? items
          .filter((item) => item.status !== "pending")
          .slice(-resolvedAllowance)
          .map((item) => item.id)
      : [],
  );
  const bounded = items.filter(
    (item) => item.status === "pending" || keepResolved.has(item.id),
  );
  await safeWriteFileAsync(path, `${JSON.stringify(bounded, null, 2)}\n`);
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

function expirePending(items: HumanAttentionItem[], now: number): boolean {
  let changed = false;
  for (const item of items) {
    if (item.status === "pending" && item.expiresAt && item.expiresAt <= now) {
      item.status = "expired";
      item.updatedAt = now;
      item.resolution = {
        choiceId: "expired",
        resolvedAt: now,
        resolvedBy: "system",
      };
      changed = true;
    }
  }
  return changed;
}

async function reconcileRunEventApprovals(profile: string): Promise<void> {
  const events = listAllHermesRunEvents(profile);
  const byRun = new Map<string, typeof events>();
  for (const event of events) {
    const runEvents = byRun.get(event.runId) ?? [];
    runEvents.push(event);
    byRun.set(event.runId, runEvents);
  }

  for (const [runId, runEvents] of byRun) {
    const snapshot = buildHermesRunResumeSnapshot(runId, runEvents);
    if (
      snapshot?.status !== "waiting-attention" ||
      !snapshot.pendingRequestId
    ) {
      continue;
    }
    const requestEvent = [...runEvents]
      .reverse()
      .find(
        (event) =>
          event.kind === "run.approval.requested" &&
          event.payload.requestId === snapshot.pendingRequestId,
      );
    if (!requestEvent) continue;
    const summary =
      typeof requestEvent.payload.description === "string"
        ? requestEvent.payload.description
        : typeof requestEvent.payload.command === "string"
          ? requestEvent.payload.command
          : "Hermes needs permission to continue this run.";
    await createHumanAttentionItem(
      {
        kind: "approval",
        source: "hermes-run-event",
        title: "Hermes needs approval",
        summary,
        idempotencyKey: `hermes-approval:${runId}:${snapshot.pendingRequestId}`,
        runId,
        sessionId: snapshot.sessionId,
        requestId: snapshot.pendingRequestId,
        choices: [
          { id: "once", label: "Allow once", tone: "primary" },
          { id: "deny", label: "Deny", tone: "danger" },
        ],
        resume: { kind: "chat", ref: runId },
      },
      profile,
    );
  }
}

export async function createHumanAttentionItem(
  input: HumanAttentionCreateInput,
  profile?: string,
): Promise<HumanAttentionItem> {
  const resolvedProfile = normalizedProfile(profile);
  const path = storePath(resolvedProfile);
  return mutate(path, async () => {
    const items = await readItems(path);
    const key = cleanRequired(input.idempotencyKey, "Idempotency key", 180);
    const existing = items.find((item) => item.idempotencyKey === key);
    if (existing) return existing;
    const item = normalizeCreateInput(input, resolvedProfile, Date.now());
    items.push(item);
    await writeItems(path, items);
    return item;
  });
}

export async function listHumanAttentionItems(
  options: HumanAttentionListOptions = {},
  profile?: string,
): Promise<HumanAttentionItem[]> {
  if (!options || typeof options !== "object")
    throw new Error("Attention list options are invalid.");
  if (
    options.status !== undefined &&
    options.status !== "all" &&
    !STATUSES.has(options.status)
  ) {
    throw new Error("Attention list status is invalid.");
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1)
  ) {
    throw new Error("Attention list limit must be a positive integer.");
  }
  const resolvedProfile = normalizedProfile(profile);
  await reconcileRunEventApprovals(resolvedProfile);
  const path = storePath(resolvedProfile);
  return mutate(path, async () => {
    const items = await readItems(path);
    if (expirePending(items, Date.now())) await writeItems(path, items);
    const status = options.status ?? "pending";
    const filtered =
      status === "all" ? items : items.filter((item) => item.status === status);
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 100), 1), 500);
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  });
}

export async function resolveHumanAttentionItem(
  itemId: string,
  input: HumanAttentionResolveInput,
  profile?: string,
): Promise<HumanAttentionResolveResult> {
  if (typeof itemId !== "string" || !itemId.trim())
    return { ok: false, error: "Attention item id is invalid." };
  if (!input || typeof input !== "object" || typeof input.choiceId !== "string")
    return { ok: false, error: "Attention resolution is invalid." };
  const path = storePath(profile);
  return mutate(path, async () => {
    const items = await readItems(path);
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return { ok: false, error: "Attention item not found." };
    const now = Date.now();
    if (expirePending(items, now)) await writeItems(path, items);
    if (item.status !== "pending") {
      return { ok: true, item, alreadyResolved: true };
    }
    const choice = item.choices.find(
      (candidate) => candidate.id === input.choiceId,
    );
    if (!choice) return { ok: false, item, error: "Unknown attention choice." };
    if (input.resolvedBy !== undefined && !RESOLVED_BY.has(input.resolvedBy)) {
      return { ok: false, item, error: "Unknown attention resolver." };
    }
    item.status = input.choiceId === "dismiss" ? "dismissed" : "resolved";
    item.updatedAt = now;
    item.resolution = {
      choiceId: input.choiceId,
      resolvedAt: now,
      resolvedBy: input.resolvedBy ?? "desktop",
      note: cleanOptional(input.note, "Resolution note", 180),
    };
    await writeItems(path, items);
    return { ok: true, item, alreadyResolved: false };
  });
}

export async function resolveHumanAttentionByRequestId(
  requestId: string,
  choiceId: string,
  profile?: string,
): Promise<HumanAttentionItem | null> {
  const path = storePath(profile);
  return mutate(path, async () => {
    const items = await readItems(path);
    const item = items.find(
      (candidate) =>
        candidate.status === "pending" && candidate.requestId === requestId,
    );
    if (!item) return null;
    if (!item.choices.some((choice) => choice.id === choiceId)) return null;
    const now = Date.now();
    item.status = choiceId === "deny" ? "dismissed" : "resolved";
    item.updatedAt = now;
    item.resolution = {
      choiceId: cleanRequired(choiceId, "Resolution choice", 64),
      resolvedAt: now,
      resolvedBy: "desktop",
    };
    await writeItems(path, items);
    return item;
  });
}

export async function humanAttentionCounts(
  profile?: string,
): Promise<HumanAttentionCounts> {
  const resolvedProfile = normalizedProfile(profile);
  await reconcileRunEventApprovals(resolvedProfile);
  const path = storePath(resolvedProfile);
  return mutate(path, async () => {
    const items = await readItems(path);
    if (expirePending(items, Date.now())) await writeItems(path, items);
    const pending = items.filter((item) => item.status === "pending");
    return {
      pending: pending.length,
      approvals: pending.filter((item) => item.kind === "approval").length,
      questions: pending.filter((item) => item.kind === "question").length,
      blockers: pending.filter((item) => item.kind === "blocked-run").length,
      failures: pending.filter((item) => item.kind === "failed-run").length,
      notifications: pending.filter((item) => item.kind === "notification")
        .length,
      proposals: pending.filter((item) => item.kind === "workspace-proposal")
        .length,
    };
  });
}
