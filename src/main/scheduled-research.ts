// scheduled-research.ts — the Scheduled Research engine (main process).
//
// Keeps a LIVING wiki page per topic current on a recurring schedule. The
// scheduler runs in the desktop main process (deterministic + testable) and
// catches up on launch; for each due schedule it: runs a web-grounded research
// turn, smart-merges the findings into the topic's page (op:"update", only on
// meaningful change), and drops the proposed merge into a pending queue that the
// renderer reviews + applies through the normal commitChangeset path. This
// routing (pending queue → renderer commit) keeps it correct in the default
// `blob` storage mode, where direct vault writes are not read back.
//
// Persistence (app metadata, NOT the overridable vault) lives under
// <profileHome>/sps-agent/: scheduled-research.json (registry),
// scheduled-research/pending/*.json (proposed merges), scheduled-research.jsonl
// (run history). Pure scheduling/validation logic lives in
// src/shared/scheduledResearch.ts (unit-tested); this module owns I/O + gateway.
import { promises as fs } from "fs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { BrowserWindow } from "electron";
import { gatewayChat, extractJson } from "./gateway-chat";
import { resolveSpsVaultDir } from "./sps-storage";
import { profileHome, safeWriteFile } from "./utils";
import { HERMES_HOME } from "./installer";
import {
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  listCronJobs,
} from "./cronjobs";
import {
  readWikiSchema,
  parseChangeset,
  buildScheduledMergeMessages,
  buildScheduledCronPrompt,
  buildExternalDigestMergeMessages,
  type IngestChangeset,
} from "./sps-ingest";
import { getExternalContextDb } from "./external-context";
import { formatProvenance } from "../shared/external-context";
import { readPageMarkdownFrom } from "./sps-vault";
import {
  buildResearchPrompt,
  capResearchBrief,
  hasUsableSources,
} from "../shared/research";
import {
  isDue,
  slugForTopic,
  validateScheduleInput,
  cronExprFor,
  periodStart,
  buildMonitorDiscoveryResult,
  buildMonitorSourceHint,
  inferBriefImportance,
  meetsImportanceThreshold,
  normalizeMonitorSourcePlan,
  MAX_SCHEDULES,
  type ScheduledResearchItem,
  type ScheduleInput,
  type MonitorDiscoveryInput,
  type MonitorDiscoveryResult,
  type MonitorSourceEntry,
} from "../shared/scheduledResearch";
import { fetchRssArticles } from "./rss-discovery";
import { telegramChannelConfigured } from "./telegram-delivery";
import { formatLogError, log } from "./log";
import { createActiveWorkRun, updateActiveWorkRun } from "./active-work-runs";
import type { ActiveWorkRun, ActiveWorkTrigger } from "../shared/active-work";

export type RunOutcome = "changed" | "no-change" | "no-sources" | "error";

export interface PendingUpdate {
  id: string;
  scheduleId: string;
  topic: string;
  pageId: string;
  ts: number;
  summary: string;
  changeset: IngestChangeset;
}

// ── paths (fixed app-metadata dir, not the overridable vault) ────────────────
function srDir(profile?: string): string {
  return join(profileHome(profile), "sps-agent");
}
function registryFile(profile?: string): string {
  return join(srDir(profile), "scheduled-research.json");
}
function pendingDir(profile?: string): string {
  return join(srDir(profile), "scheduled-research", "pending");
}
function historyFile(profile?: string): string {
  return join(srDir(profile), "scheduled-research.jsonl");
}
/** Where the gateway writes a cron job's delivered output (deliver:"local").
 *  Root-level (not profile-scoped) — the cron subsystem lives at HERMES_HOME. */
function cronOutputDir(jobId: string): string {
  return join(HERMES_HOME, "cron", "output", jobId);
}

/** Create and verify the paired gateway cron job for a research schedule. */
async function createPairedCron(
  item: ScheduledResearchItem,
  profile?: string,
): Promise<string> {
  const name = `sr:${item.id}`;
  const res = await createCronJob(
    cronExprFor(item.cadence, item.hour),
    buildScheduledCronPrompt(item.topic, buildMonitorSourceHint(item)),
    name,
    "local",
    profile,
  );
  if (!res.success)
    throw new Error(res.error || "Could not create the research cron job.");
  const jobs = await listCronJobs(true, profile);
  const job = [...jobs].reverse().find((candidate) => candidate.name === name);
  if (!job)
    throw new Error(
      "The research cron job was created but could not be verified.",
    );
  return job.id;
}

// ── registry CRUD ────────────────────────────────────────────────────────────
function loadRegistry(profile?: string): {
  schedules: ScheduledResearchItem[];
} {
  if (!existsSync(registryFile(profile))) return { schedules: [] };
  try {
    const raw = readFileSync(registryFile(profile), "utf-8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.schedules))
      throw new Error("registry schedules must be an array");
    const schedules = data.schedules as ScheduledResearchItem[];
    return { schedules };
  } catch (error) {
    throw new Error(
      `Scheduled research registry could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function saveRegistry(
  reg: { schedules: ScheduledResearchItem[] },
  profile?: string,
): void {
  const dir = srDir(profile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  safeWriteFile(registryFile(profile), `${JSON.stringify(reg, null, 2)}\n`);
}

export function listSchedules(profile?: string): ScheduledResearchItem[] {
  return loadRegistry(profile).schedules;
}

let _idSeq = 0;
function newId(): string {
  _idSeq += 1;
  return `sr_${Date.now().toString(36)}_${_idSeq}`;
}

export async function createSchedule(
  input: ScheduleInput,
  profile?: string,
): Promise<{ ok: boolean; item?: ScheduledResearchItem; error?: string }> {
  const err = validateScheduleInput(input);
  if (err) return { ok: false, error: err };
  const reg = loadRegistry(profile);
  if (reg.schedules.length >= MAX_SCHEDULES) {
    return { ok: false, error: `At most ${MAX_SCHEDULES} schedules.` };
  }
  const isDigest = input.kind === "digest";
  const topic = isDigest
    ? input.topic.trim() || "External sessions digest"
    : input.topic.trim();
  const pageId = slugForTopic(topic);
  if (reg.schedules.some((s) => s.pageId === pageId)) {
    return { ok: false, error: "A schedule for that topic already exists." };
  }
  const item: ScheduledResearchItem = {
    id: newId(),
    kind: isDigest ? "digest" : "research",
    scope: isDigest ? input.scope : undefined,
    sourceIntent: isDigest ? undefined : (input.sourceIntent ?? "all"),
    sourcePlan: isDigest
      ? undefined
      : normalizeMonitorSourcePlan(input.sourcePlan),
    importanceThreshold: isDigest
      ? undefined
      : (input.importanceThreshold ?? "noteworthy"),
    telegramPush: isDigest ? undefined : (input.telegramPush ?? false),
    telegramMode: isDigest
      ? undefined
      : input.telegramPush
        ? (input.telegramMode ?? "summary-only")
        : input.telegramMode,
    topic,
    pageId,
    cadence: input.cadence,
    hour: input.hour ?? 8,
    autoApply: input.autoApply ?? false,
    enabled: true,
    createdAt: Date.now(),
    lastRunAt: 0,
    lastChangeHash: "",
  };
  // Research schedules must verify their paired cron before the registry claims
  // they are enabled. Digests use local data and intentionally run app-open.
  if (!isDigest) {
    try {
      item.cronJobId = await createPairedCron(item, profile);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not enable the research schedule.",
      };
    }
  }
  reg.schedules.push(item);
  try {
    saveRegistry(reg, profile);
  } catch (error) {
    if (item.cronJobId) await removeCronJob(item.cronJobId, profile);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not save the research schedule.",
    };
  }
  return { ok: true, item };
}

export async function updateSchedule(
  id: string,
  patch: Partial<
    Pick<
      ScheduledResearchItem,
      | "cadence"
      | "hour"
      | "enabled"
      | "autoApply"
      | "sourceIntent"
      | "sourcePlan"
      | "importanceThreshold"
      | "telegramPush"
      | "telegramMode"
    >
  >,
  profile?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!patch || typeof patch !== "object")
    return { ok: false, error: "Schedule update is invalid." };
  const allowedKeys = new Set([
    "cadence",
    "hour",
    "enabled",
    "autoApply",
    "sourceIntent",
    "sourcePlan",
    "importanceThreshold",
    "telegramPush",
    "telegramMode",
  ]);
  const unsupported = Object.keys(patch).find((key) => !allowedKeys.has(key));
  if (unsupported)
    return { ok: false, error: `${unsupported} cannot be changed.` };
  if (
    patch.cadence !== undefined &&
    !["daily", "weekly", "monthly"].includes(String(patch.cadence))
  ) {
    return { ok: false, error: "Schedule cadence is invalid." };
  }
  if (
    patch.hour !== undefined &&
    (!Number.isInteger(patch.hour) || patch.hour < 0 || patch.hour > 23)
  ) {
    return { ok: false, error: "Schedule hour must be 0-23." };
  }
  for (const key of ["enabled", "autoApply", "telegramPush"] as const) {
    if (patch[key] !== undefined && typeof patch[key] !== "boolean")
      return { ok: false, error: `${key} must be boolean.` };
  }
  if (
    patch.sourceIntent !== undefined &&
    !["all", "web", "rss", "substack", "social"].includes(patch.sourceIntent)
  ) {
    return { ok: false, error: "Source intent is invalid." };
  }
  if (
    patch.importanceThreshold !== undefined &&
    !["digest", "noteworthy", "breaking"].includes(patch.importanceThreshold)
  ) {
    return { ok: false, error: "Importance threshold is invalid." };
  }
  if (
    patch.telegramMode !== undefined &&
    patch.telegramMode !== "summary-only"
  ) {
    return { ok: false, error: "Telegram mode is invalid." };
  }
  if (patch.sourcePlan !== undefined && !Array.isArray(patch.sourcePlan)) {
    return { ok: false, error: "Source plan is invalid." };
  }
  const reg = loadRegistry(profile);
  const item = reg.schedules.find((s) => s.id === id);
  if (!item) return { ok: false, error: "Schedule not found." };
  const next: ScheduledResearchItem = { ...item };
  const cronShapeChanged =
    patch.cadence !== undefined ||
    patch.hour !== undefined ||
    patch.sourceIntent !== undefined ||
    patch.sourcePlan !== undefined ||
    patch.importanceThreshold !== undefined ||
    patch.telegramPush !== undefined ||
    patch.telegramMode !== undefined;
  if (patch.cadence !== undefined) next.cadence = patch.cadence;
  if (patch.hour !== undefined) next.hour = patch.hour;
  if (patch.enabled !== undefined) next.enabled = patch.enabled;
  if (patch.autoApply !== undefined) next.autoApply = patch.autoApply;
  if (patch.sourceIntent !== undefined) next.sourceIntent = patch.sourceIntent;
  if (patch.sourcePlan !== undefined)
    next.sourcePlan = normalizeMonitorSourcePlan(patch.sourcePlan);
  if (patch.importanceThreshold !== undefined)
    next.importanceThreshold = patch.importanceThreshold;
  if (patch.telegramPush !== undefined) next.telegramPush = patch.telegramPush;
  if (patch.telegramMode !== undefined) next.telegramMode = patch.telegramMode;

  try {
    if (next.kind !== "digest") {
      if (cronShapeChanged && item.cronJobId) {
        const replacementId = await createPairedCron(next, profile);
        if (!next.enabled) {
          const paused = await pauseCronJob(replacementId, profile);
          if (!paused.success) {
            await removeCronJob(replacementId, profile);
            throw new Error(
              paused.error || "Could not pause the replacement cron job.",
            );
          }
        }
        const removed = await removeCronJob(item.cronJobId, profile);
        if (!removed.success) {
          await removeCronJob(replacementId, profile);
          throw new Error(
            removed.error || "Could not replace the research cron job.",
          );
        }
        next.cronJobId = replacementId;
      } else if (!item.cronJobId) {
        next.cronJobId = await createPairedCron(next, profile);
        if (!next.enabled) {
          const paused = await pauseCronJob(next.cronJobId, profile);
          if (!paused.success) {
            await removeCronJob(next.cronJobId, profile);
            throw new Error(
              paused.error || "Could not pause the research cron job.",
            );
          }
        }
      } else {
        const toggled = next.enabled
          ? await resumeCronJob(item.cronJobId, profile)
          : await pauseCronJob(item.cronJobId, profile);
        if (!toggled.success)
          throw new Error(
            toggled.error || "Could not update the research cron job.",
          );
        next.cronJobId = item.cronJobId;
      }
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not update the research schedule.",
    };
  }
  reg.schedules = reg.schedules.map((schedule) =>
    schedule.id === id ? next : schedule,
  );
  saveRegistry(reg, profile);
  return { ok: true };
}

export async function discoverScheduleSources(
  input: MonitorDiscoveryInput,
  _profile?: string,
): Promise<MonitorDiscoveryResult> {
  return buildMonitorDiscoveryResult(input);
}

export async function updateScheduleSourcePlan(
  id: string,
  sourcePlan: MonitorSourceEntry[],
  profile?: string,
): Promise<{ ok: boolean; error?: string }> {
  return updateSchedule(id, { sourcePlan }, profile);
}

export async function deleteSchedule(
  id: string,
  profile?: string,
): Promise<{ ok: boolean; error?: string }> {
  const reg = loadRegistry(profile);
  const item = reg.schedules.find((s) => s.id === id);
  if (item?.cronJobId) {
    const removed = await removeCronJob(item.cronJobId, profile);
    if (!removed.success) {
      return {
        ok: false,
        error: removed.error || "Could not remove the research cron job.",
      };
    }
  }
  reg.schedules = reg.schedules.filter((s) => s.id !== id);
  saveRegistry(reg, profile);
  return { ok: true };
}

// ── pending queue ────────────────────────────────────────────────────────────
export async function listPending(profile?: string): Promise<PendingUpdate[]> {
  const dir = pendingDir(profile);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: PendingUpdate[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(join(dir, name), "utf-8");
      out.push(JSON.parse(raw) as PendingUpdate);
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export async function removePending(
  id: string,
  profile?: string,
): Promise<{ ok: boolean }> {
  // id is validated to a safe filename stem.
  if (!/^[A-Za-z0-9_]+$/.test(id)) return { ok: false };
  try {
    await fs.unlink(join(pendingDir(profile), `${id}.json`));
  } catch {
    /* already gone */
  }
  return { ok: true };
}

async function writePending(p: PendingUpdate, profile?: string): Promise<void> {
  const dir = pendingDir(profile);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(join(dir, `${p.id}.json`), JSON.stringify(p, null, 2));
}

// ── run history ──────────────────────────────────────────────────────────────
function recordHistory(
  scheduleId: string,
  outcome: RunOutcome,
  summary: string,
  profile?: string,
  meta: {
    activeWorkRunId?: string;
    trigger?: ActiveWorkTrigger;
    transcript?: string;
  } = {},
): string {
  const id = `srr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const dir = srDir(profile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      id,
      scheduleId,
      ts: Date.now(),
      outcome,
      summary,
      ...meta,
      transcript: meta.transcript?.slice(0, 12_000),
    });
    writeFileSync(historyFile(profile), line + "\n", { flag: "a" });
  } catch {
    log.error("scheduled-research", {
      msg: "failed to persist run transcript",
      scheduleId,
      profile,
    });
    return "";
  }
  return id;
}

async function createScheduledActiveWork(
  item: ScheduledResearchItem,
  trigger: ActiveWorkTrigger,
  profile?: string,
  clientRunId?: string,
): Promise<ActiveWorkRun> {
  return createActiveWorkRun(
    {
      source: "scheduled-research",
      trigger,
      reviewPolicy: "review-first",
      clientRunId,
      title: `${item.kind === "digest" ? "Digest" : "Research"}: ${item.topic}`,
      goal: `Check ${item.topic} and produce a sourced, reviewable update when findings changed.`,
      criteria: [
        {
          text: "Determine whether the monitored topic changed and preserve the evidence.",
        },
      ],
      expectedArtifacts: [
        { kind: "transcript", label: "Run transcript", required: true },
      ],
    },
    profile,
  );
}

async function finalizeScheduledActiveWork(
  active: ActiveWorkRun,
  item: ScheduledResearchItem,
  outcome: RunOutcome,
  summary: string,
  historyId: string,
  pending?: PendingUpdate,
  profile?: string,
): Promise<void> {
  const now = Date.now();
  const summaryArtifact = {
    id: `artifact_${now.toString(36)}_summary`,
    kind: "text" as const,
    label: "Run outcome",
    ref: summary,
    createdAt: now,
  };
  const transcriptArtifact = {
    id: `artifact_${now.toString(36)}_transcript`,
    kind: "transcript" as const,
    label: "Scheduled run transcript",
    ref: historyId,
    createdAt: now,
  };
  const artifacts = [
    summaryArtifact,
    transcriptArtifact,
    ...(pending
      ? [
          {
            id: `artifact_${now.toString(36)}_proposal`,
            kind: "proposal" as const,
            label: "Reviewable research update",
            ref: pending.id,
            createdAt: now,
          },
          {
            id: `artifact_${now.toString(36)}_page`,
            kind: "page" as const,
            label: item.topic,
            ref: item.pageId,
            createdAt: now,
          },
        ]
      : []),
  ];
  if (outcome === "error" || outcome === "no-sources") {
    await updateActiveWorkRun(
      active.id,
      { status: "failed", error: summary, completedAt: now, artifacts },
      profile,
    );
    return;
  }
  await updateActiveWorkRun(
    active.id,
    {
      status: outcome === "changed" ? "awaiting-review" : "completed",
      summary,
      criteria: active.criteria.map((criterion) => ({
        ...criterion,
        done: true,
        evidence: {
          summary:
            outcome === "changed"
              ? "A reviewable update and source transcript were produced."
              : "The run recorded that no meaningful change was found.",
          artifactId: transcriptArtifact.id,
          verifiedAt: now,
          verifiedBy: "system" as const,
        },
      })),
      artifacts,
      completedAt: outcome === "changed" ? undefined : now,
    },
    profile,
  );
}

async function safelyFinalizeScheduledActiveWork(
  active: ActiveWorkRun,
  item: ScheduledResearchItem,
  outcome: RunOutcome,
  summary: string,
  historyId: string,
  pending: PendingUpdate | undefined,
  profile?: string,
): Promise<void> {
  if (!historyId) {
    const error =
      "Scheduled run transcript could not be persisted; the run cannot be reported as complete.";
    await updateActiveWorkRun(
      active.id,
      { status: "failed", error, completedAt: Date.now() },
      profile,
    );
    throw new Error(error);
  }
  try {
    await finalizeScheduledActiveWork(
      active,
      item,
      outcome,
      summary,
      historyId,
      pending,
      profile,
    );
  } catch (error) {
    await updateActiveWorkRun(
      active.id,
      {
        status: "failed",
        error: `Outcome recording failed: ${error instanceof Error ? error.message : String(error)}`,
        completedAt: Date.now(),
      },
      profile,
    );
  }
}

// ── gateway call ─────────────────────────────────────────────────────────────
// ── the run ──────────────────────────────────────────────────────────────────
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function approvedFeedSources(
  item: ScheduledResearchItem,
): MonitorSourceEntry[] {
  return normalizeMonitorSourcePlan(item.sourcePlan).filter(
    (source) =>
      source.status === "approved" &&
      !!source.url &&
      (source.kind === "rss" || source.kind === "substack"),
  );
}

function stampSourceResults(
  itemId: string,
  checkedIds: string[],
  failures: Map<string, string>,
  profile?: string,
): void {
  if (!checkedIds.length && !failures.size) return;
  const reg = loadRegistry(profile);
  const found = reg.schedules.find((s) => s.id === itemId);
  if (!found?.sourcePlan) return;
  const checked = new Set(checkedIds);
  const now = Date.now();
  found.sourcePlan = normalizeMonitorSourcePlan(found.sourcePlan).map(
    (source) => {
      if (checked.has(source.id)) {
        const next = { ...source, lastCheckedAt: now };
        delete next.lastError;
        delete next.lastErrorAt;
        return next;
      }
      const error = failures.get(source.id);
      return error ? { ...source, lastError: error, lastErrorAt: now } : source;
    },
  );
  saveRegistry(reg, profile);
}

async function buildApprovedFeedContext(
  item: ScheduledResearchItem,
  profile?: string,
): Promise<string> {
  const feeds = approvedFeedSources(item).slice(0, 8);
  if (!feeds.length) return "";

  const checkedIds: string[] = [];
  const failures = new Map<string, string>();
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const source of feeds) {
    if (!source.url) continue;
    try {
      const articles = await fetchRssArticles(source.url);
      checkedIds.push(source.id);
      const lines = articles
        .filter((article) => article.url || article.title)
        .slice(0, 8)
        .map((article) => {
          const key = sha256(`${article.url || ""}\n${article.title}`);
          if (seen.has(key)) return "";
          seen.add(key);
          const date = article.published_at
            ? new Date(article.published_at).toISOString().slice(0, 10)
            : "";
          const title = article.title || "Untitled";
          const link = article.url ? `[${title}](${article.url})` : title;
          const excerpt = article.summary_excerpt
            ? ` — ${article.summary_excerpt}`
            : "";
          return `- ${date ? `${date}: ` : ""}${link}${excerpt}`;
        })
        .filter(Boolean);
      if (lines.length) {
        sections.push(`### ${source.label}\n${lines.join("\n")}`);
      }
    } catch (err) {
      failures.set(
        source.id,
        err instanceof Error ? err.message : "Feed check failed.",
      );
    }
  }
  stampSourceResults(item.id, checkedIds, failures, profile);
  if (!sections.length) return "";
  return [
    "Recent entries fetched from approved RSS/Substack sources:",
    ...sections,
  ].join("\n");
}

async function buildRunSourceHint(
  item: ScheduledResearchItem,
  profile?: string,
): Promise<string> {
  const parts = [buildMonitorSourceHint(item)];
  const feedContext = await buildApprovedFeedContext(item, profile);
  if (feedContext) parts.push(feedContext);
  return parts.join("\n\n");
}

function oneLineSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

async function deliverTelegramSummary(
  item: ScheduledResearchItem,
  summary: string,
  brief: string,
  profile?: string,
): Promise<string | null> {
  if (!item.telegramPush) return null;
  const threshold = item.importanceThreshold ?? "noteworthy";
  const importance = inferBriefImportance(`${summary}\n${brief}`);
  if (!meetsImportanceThreshold(importance, threshold)) {
    return `Telegram skipped: ${importance} below ${threshold}.`;
  }
  if (!telegramChannelConfigured(profile)) {
    return "Telegram delivery unavailable: no configured Telegram channel.";
  }

  const line = oneLineSummary(`${item.topic}: ${summary}`);
  try {
    const result = await gatewayChat(
      [
        {
          role: "user",
          content: [
            "Send exactly one Telegram message to the user's configured Telegram channel using the Hermes messaging tool.",
            "Use summary-only mode. Do not include extra commentary.",
            `Message: ${line}`,
            "If Telegram is not configured or the send fails, reply with TELEGRAM_UNAVAILABLE followed by the reason.",
          ].join("\n"),
        },
      ],
      512,
      profile,
    );
    if (/TELEGRAM_UNAVAILABLE|failed|error|not configured/i.test(result)) {
      return `Telegram delivery failed: ${oneLineSummary(result) || "unknown error"}`;
    }
    return null;
  } catch (err) {
    return `Telegram delivery failed: ${
      err instanceof Error ? err.message : "unknown error"
    }`;
  }
}

/** Build the OpenAI-style merge messages for a brief. Pluggable so research and
 *  digest schedules share the same pending/hash/notify path below. */
type MergeMessagesBuilder = (
  schema: string,
  current: string | null,
  cappedBrief: string,
  dateStr: string,
) => Array<{ role: string; content: string }>;

/** Smart-merge a brief into the living page → pending queue. Shared by the
 *  research "Run now"/cron-drain paths AND the external-sessions digest run; the
 *  only kind-specific bit is the injected `buildMessages` (defaults to research).
 *  0 pages from the merge ⇒ no meaningful change. Stamps lastRunAt +
 *  lastChangeHash so the desktop fallback doesn't re-fire. */
async function mergeBriefAndQueue(
  item: ScheduledResearchItem,
  brief: string,
  getWindow?: () => BrowserWindow | null,
  profile?: string,
  buildMessages?: MergeMessagesBuilder,
): Promise<{ outcome: RunOutcome; summary: string; pending?: PendingUpdate }> {
  const cappedBrief = capResearchBrief(brief);
  const briefHash = sha256(cappedBrief);
  if (item.lastChangeHash && item.lastChangeHash === briefHash) {
    stampHash(item, briefHash, profile);
    return { outcome: "no-change", summary: "No new findings." };
  }
  const vaultDir = resolveSpsVaultDir(profile);
  const schema = await readWikiSchema(vaultDir);
  let current: string | null = null;
  try {
    current = await readPageMarkdownFrom(vaultDir, item.pageId);
  } catch {
    current = null;
  }
  const dateStr = new Date().toISOString().slice(0, 10);
  const build: MergeMessagesBuilder =
    buildMessages ??
    ((s, cur, b, d) =>
      buildScheduledMergeMessages(s, item.topic, item.pageId, cur, b, d, []));
  const messages = build(schema, current, cappedBrief, dateStr);
  const content = await gatewayChat(messages, 4096, profile);
  const changeset = parseChangeset(extractJson(content));
  if (!changeset || changeset.pages.length === 0) {
    stampHash(item, briefHash, profile);
    return { outcome: "no-change", summary: "No meaningful change." };
  }
  const op: "create" | "update" = current ? "update" : "create";
  const page = { ...changeset.pages[0], pageId: item.pageId, op };
  const merged: IngestChangeset = {
    summary: changeset.summary || `Updated ${item.topic}`,
    pages: [page],
    captures: [],
    memory: [],
  };
  const ts = Date.now();
  const pending: PendingUpdate = {
    id: `${item.id}__${ts}`,
    scheduleId: item.id,
    topic: item.topic,
    pageId: item.pageId,
    ts,
    summary: merged.summary,
    changeset: merged,
  };
  await writePending(pending, profile);
  stampHash(item, briefHash, profile);
  const deliveryNote = await deliverTelegramSummary(
    item,
    merged.summary,
    cappedBrief,
    profile,
  );
  getWindow?.()?.webContents.send("scheduled-research-update", {
    scheduleId: item.id,
    topic: item.topic,
    summary: merged.summary,
  });
  return {
    outcome: "changed",
    summary: deliveryNote
      ? `${merged.summary} (${deliveryNote})`
      : merged.summary,
    pending,
  };
}

/** Immediate run ("Run now", app-open): research turn → merge → pending. Always
 *  stamps lastRunAt (even on failure) so a transient outage can't hammer the
 *  gateway every tick. */
export async function runScheduledResearch(
  item: ScheduledResearchItem,
  getWindow?: () => BrowserWindow | null,
  profile?: string,
  activeWork?: ActiveWorkRun,
  trigger: ActiveWorkTrigger = "scheduled",
): Promise<{ outcome: RunOutcome; summary?: string; error?: string }> {
  let outcome: RunOutcome = "error";
  let summary = "";
  let transcript = "";
  let pending: PendingUpdate | undefined;
  try {
    const brief = await gatewayChat(
      [
        {
          role: "user",
          content: buildResearchPrompt(item.topic, {
            sourceHint: await buildRunSourceHint(item, profile),
          }),
        },
      ],
      3000,
      profile,
    );
    transcript = brief;
    if (!hasUsableSources(brief)) {
      outcome = "no-sources";
      summary = "No web sources returned.";
      stampRunFailure(item.id, summary, profile);
      sendRunFailure(item, summary, getWindow);
      return { outcome, summary };
    }
    const r = await mergeBriefAndQueue(item, brief, getWindow, profile);
    outcome = r.outcome;
    summary = r.summary;
    pending = r.pending;
    return { outcome, summary };
  } catch (err) {
    outcome = "error";
    summary = err instanceof Error ? err.message : "run failed";
    stampRunFailure(item.id, summary, profile);
    sendRunFailure(item, summary, getWindow);
    return { outcome, summary, error: summary };
  } finally {
    const historyId = recordHistory(item.id, outcome, summary, profile, {
      activeWorkRunId: activeWork?.id,
      trigger,
      transcript,
    });
    if (activeWork) {
      await safelyFinalizeScheduledActiveWork(
        activeWork,
        item,
        outcome,
        summary,
        historyId,
        pending,
        profile,
      );
    }
  }
}

/** Per-message excerpt cap inside an assembled digest source (the whole thing is
 *  capped again by mergeBriefAndQueue → capResearchBrief). */
const DIGEST_MSG_CHARS = 300;

/** Immediate/scheduled digest run (app-open): query the period's external
 *  sessions from the redacted index, assemble a provenance-labelled source, and
 *  smart-merge it into the living digest page → pending. Mirrors
 *  runScheduledResearch but the "brief" is local session data, not web research. */
export async function runDigest(
  item: ScheduledResearchItem,
  getWindow?: () => BrowserWindow | null,
  profile?: string,
  activeWork?: ActiveWorkRun,
  trigger: ActiveWorkTrigger = "scheduled",
): Promise<{ outcome: RunOutcome; summary?: string; error?: string }> {
  let outcome: RunOutcome = "error";
  let summary = "";
  let transcript = "";
  let pending: PendingUpdate | undefined;
  try {
    const db = getExternalContextDb();
    const windowStart = periodStart(item.cadence, new Date());
    const convs = db.listConversationsSince(windowStart, {
      ...(item.scope ?? {}),
      limit: 40,
    });
    if (convs.length === 0) {
      outcome = "no-change";
      summary = "No external sessions this period.";
      stampRunSuccess(item.id, profile);
      return { outcome, summary };
    }
    const digestSource = convs
      .map((c) => {
        const prov = formatProvenance({
          source: c.source,
          projectPath: c.projectPath,
          gitBranch: c.gitBranch,
          title: c.title,
          ts: c.lastAt ?? c.startedAt,
        });
        const body = db
          .getConversation(c.convId, { limit: 8 })
          .map((m) => `${m.role}: ${m.text.slice(0, DIGEST_MSG_CHARS)}`)
          .join("\n");
        return `### ${prov}\n${body}`;
      })
      .join("\n\n");
    transcript = digestSource;
    const r = await mergeBriefAndQueue(
      item,
      digestSource,
      getWindow,
      profile,
      (schema, current, brief, dateStr) =>
        buildExternalDigestMergeMessages(
          schema,
          item.pageId,
          current,
          brief,
          dateStr,
          [],
        ),
    );
    outcome = r.outcome;
    summary = r.summary;
    pending = r.pending;
    return { outcome, summary };
  } catch (err) {
    outcome = "error";
    summary = err instanceof Error ? err.message : "digest failed";
    stampRunFailure(item.id, summary, profile);
    sendRunFailure(item, summary, getWindow);
    return { outcome, summary, error: summary };
  } finally {
    const historyId = recordHistory(item.id, outcome, summary, profile, {
      activeWorkRunId: activeWork?.id,
      trigger,
      transcript,
    });
    if (activeWork) {
      await safelyFinalizeScheduledActiveWork(
        activeWork,
        item,
        outcome,
        summary,
        historyId,
        pending,
        profile,
      );
    }
  }
}

/** Dispatch a due/triggered schedule to the right run by kind. */
export async function runSchedule(
  item: ScheduledResearchItem,
  getWindow?: () => BrowserWindow | null,
  profile?: string,
  trigger: ActiveWorkTrigger = "scheduled",
): Promise<{ outcome: RunOutcome; summary?: string; error?: string }> {
  const active = await createScheduledActiveWork(item, trigger, profile);
  return item.kind === "digest"
    ? runDigest(item, getWindow, profile, active, trigger)
    : runScheduledResearch(item, getWindow, profile, active, trigger);
}

/** Extract the agent's brief from a gateway cron-output file. The file is a
 *  "# Cron Job …\n## Prompt …\n## Response\n<final>" doc; we want <final>, unless
 *  it's the native [SILENT] no-change sentinel. */
export function parseCronBrief(content: string): string | null {
  const m = /##\s*Response\s*\n([\s\S]*)$/i.exec(content);
  let body = (m ? m[1] : content).trim();
  body = body.replace(/^⚠️[^\n]*\n+/, "").trim(); // drop skill-not-found notices
  if (!body || /^\[SILENT\]/i.test(body)) return null;
  return body;
}

/** Drain newly-delivered cron-output briefs into the merge → pending pipeline.
 *  This is how app-CLOSED scheduled runs reach the KB: the gateway cron wrote the
 *  brief to cron/output/<jobId>/; we merge anything newer than lastDrainedAt. */
export async function drainCronBriefs(
  getWindow?: () => BrowserWindow | null,
  profile?: string,
): Promise<void> {
  const reg = loadRegistry(profile);
  for (const item of reg.schedules) {
    if (!item.cronJobId) continue;
    const dir = cronOutputDir(item.cronJobId);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    const since = item.lastDrainedAt || 0;
    const fresh: Array<{ name: string; mtime: number }> = [];
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      try {
        const st = await fs.stat(join(dir, name));
        if (st.mtimeMs > since) fresh.push({ name, mtime: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
    if (!fresh.length) continue;
    fresh.sort((a, b) => a.mtime - b.mtime);
    // Advance the cursor only across the contiguous prefix of briefs we actually
    // handled. A transient merge/read failure (gateway hiccup, parse error) must
    // hold the cursor at the last good brief so the failed one is retried next
    // run — advancing past it unconditionally permanently loses that brief even
    // though the file still exists on disk.
    let watermark = since;
    let stalled = false;
    for (const f of fresh) {
      const active = await createScheduledActiveWork(
        item,
        "cron",
        profile,
        `scheduled-research:${item.id}:${f.name}:${f.mtime}`,
      );
      let content: string;
      try {
        content = await fs.readFile(join(dir, f.name), "utf-8");
      } catch (err) {
        const message = `Cron brief could not be read: ${
          err instanceof Error ? err.message : String(err)
        }`;
        const historyId = recordHistory(item.id, "error", message, profile, {
          activeWorkRunId: active.id,
          trigger: "cron",
        });
        await safelyFinalizeScheduledActiveWork(
          active,
          item,
          "error",
          message,
          historyId,
          undefined,
          profile,
        );
        stampRunFailure(item.id, message, profile);
        sendRunFailure(item, message, getWindow);
        stalled = true;
        continue;
      }
      const brief = parseCronBrief(content);
      if (!brief) {
        const warning = content.match(/⚠️[^\n]*/)?.[0]?.trim();
        const outcome: RunOutcome = warning ? "error" : "no-change";
        const summary = warning
          ? `Cron runner warning: ${warning}`
          : "Cron reported no meaningful change.";
        const historyId = recordHistory(item.id, outcome, summary, profile, {
          activeWorkRunId: active.id,
          trigger: "cron",
          transcript: content,
        });
        await safelyFinalizeScheduledActiveWork(
          active,
          item,
          outcome,
          summary,
          historyId,
          undefined,
          profile,
        );
        if (warning) {
          stampRunFailure(item.id, summary, profile);
          sendRunFailure(item, summary, getWindow);
        } else {
          stampRunSuccess(item.id, profile);
        }
        if (!stalled) watermark = f.mtime;
        continue;
      }
      if (item.kind !== "digest" && !hasUsableSources(brief)) {
        const message = "No web sources returned.";
        const historyId = recordHistory(
          item.id,
          "no-sources",
          message,
          profile,
          {
            activeWorkRunId: active.id,
            trigger: "cron",
            transcript: content,
          },
        );
        await safelyFinalizeScheduledActiveWork(
          active,
          item,
          "no-sources",
          message,
          historyId,
          undefined,
          profile,
        );
        stampRunFailure(item.id, message, profile);
        sendRunFailure(item, message, getWindow);
        if (!stalled) watermark = f.mtime;
        continue;
      }
      try {
        const r = await mergeBriefAndQueue(item, brief, getWindow, profile);
        const historyId = recordHistory(
          item.id,
          r.outcome,
          r.summary,
          profile,
          {
            activeWorkRunId: active.id,
            trigger: "cron",
            transcript: content,
          },
        );
        await safelyFinalizeScheduledActiveWork(
          active,
          item,
          r.outcome,
          r.summary,
          historyId,
          r.pending,
          profile,
        );
        if (!stalled) watermark = f.mtime;
      } catch (err) {
        const message = err instanceof Error ? err.message : "merge failed";
        const historyId = recordHistory(item.id, "error", message, profile, {
          activeWorkRunId: active.id,
          trigger: "cron",
          transcript: content,
        });
        await safelyFinalizeScheduledActiveWork(
          active,
          item,
          "error",
          message,
          historyId,
          undefined,
          profile,
        );
        stampRunFailure(item.id, message, profile);
        sendRunFailure(item, message, getWindow);
        stalled = true;
      }
    }
    if (watermark > since) {
      // Re-load: mergeBriefAndQueue re-saved the registry via stampHash.
      const reg2 = loadRegistry(profile);
      const it2 = reg2.schedules.find((s) => s.id === item.id);
      if (it2) {
        it2.lastDrainedAt = watermark;
        saveRegistry(reg2, profile);
      }
    }
  }
}

/** Stamp lastRunAt + lastChangeHash for an item by id. */
function stampHash(
  item: ScheduledResearchItem,
  hash: string,
  profile?: string,
): void {
  const reg = loadRegistry(profile);
  const found = reg.schedules.find((s) => s.id === item.id);
  if (!found) return;
  found.lastRunAt = Date.now();
  found.lastChangeHash = hash;
  delete found.lastError;
  delete found.lastErrorAt;
  saveRegistry(reg, profile);
}

function stampRunSuccess(id: string, profile?: string): void {
  const reg = loadRegistry(profile);
  const found = reg.schedules.find((s) => s.id === id);
  if (!found) return;
  found.lastRunAt = Date.now();
  delete found.lastError;
  delete found.lastErrorAt;
  saveRegistry(reg, profile);
}

function stampRunFailure(id: string, error: string, profile?: string): void {
  const reg = loadRegistry(profile);
  const found = reg.schedules.find((s) => s.id === id);
  if (!found) return;
  const now = Date.now();
  found.lastRunAt = now;
  found.lastError = error.slice(0, 500);
  found.lastErrorAt = now;
  saveRegistry(reg, profile);
}

function sendRunFailure(
  item: ScheduledResearchItem,
  error: string,
  getWindow?: () => BrowserWindow | null,
): void {
  getWindow?.()?.webContents.send("scheduled-research-update", {
    scheduleId: item.id,
    topic: item.topic,
    summary: error,
    outcome: "error",
    error,
  });
}

/** Run a schedule immediately regardless of its cadence (the UI "Run now"). */
export async function triggerScheduleNow(
  id: string,
  getWindow?: () => BrowserWindow | null,
  profile?: string,
): Promise<{ outcome: RunOutcome; summary?: string; error?: string }> {
  const item = loadRegistry(profile).schedules.find((s) => s.id === id);
  if (!item) return { outcome: "error", error: "Schedule not found." };
  return runSchedule(item, getWindow, profile, "manual");
}

// ── scheduler loop ───────────────────────────────────────────────────────────
let _timer: ReturnType<typeof setInterval> | null = null;
let _startupTimer: ReturnType<typeof setTimeout> | null = null;
let _running = false;
let _getWindow: (() => BrowserWindow | null) | null = null;

async function tick(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    // Primary path: ingest whatever the gateway cron jobs delivered (app-closed).
    await drainCronBriefs(_getWindow ?? undefined);
    // Fallback only: a schedule with no paired cron job (cron-create failed) is
    // still fired app-open by the desktop, so it never silently stalls.
    const now = new Date();
    const due = loadRegistry().schedules.filter(
      (s) => !s.cronJobId && isDue(s, now),
    );
    for (const s of due) {
      await runSchedule(s, _getWindow ?? undefined);
    }
  } catch (err) {
    log.error("scheduled-research", {
      msg: "scheduler tick failed",
      error: formatLogError(err),
    });
  } finally {
    _running = false;
  }
}

function scheduleTick(): void {
  tick().catch((error) => {
    log.error("scheduled-research", {
      msg: "scheduler tick failed",
      error: formatLogError(error),
    });
  });
}

/** Start the scheduler: a catch-up pass shortly after launch, then hourly-ish
 *  ticks (every 60s the due-check is cheap; runs only fire per cadence). */
export function startScheduledResearch(
  getWindow: () => BrowserWindow | null,
): void {
  if (_timer || _startupTimer) return;
  _getWindow = getWindow;
  // Delay the first pass so the gateway has a moment to be reachable on launch.
  _startupTimer = setTimeout(() => {
    _startupTimer = null;
    scheduleTick();
  }, 20000);
  _startupTimer.unref?.();
  _timer = setInterval(scheduleTick, 60000);
  _timer.unref?.();
}

export function stopScheduledResearch(): void {
  if (_startupTimer) clearTimeout(_startupTimer);
  _startupTimer = null;
  if (_timer) clearInterval(_timer);
  _timer = null;
  _getWindow = null;
}
