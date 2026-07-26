// scheduleModel.ts — one row shape over the three kinds of scheduled work.
//
// The app schedules work from three independent places, and each publishes a
// different shape: scheduled-research rules and app-launch recipes carry
// epoch-ms timestamps and derive their next run from a cadence, while gateway
// cron jobs carry ISO strings and publish `next_run_at` outright. Normalizing
// here is what lets one surface list all three, and keeps the spread out of
// the component.
//
// Deliberately NOT computed here: a next-run time for cadence-driven sources.
// They don't publish one, and inventing it from the cadence would be a guess
// displayed as a fact — the row shows the cadence instead.
import type { AppLaunchSchedule } from "../../../../../shared/app-launcher";
import type { CronJob } from "../../../../../shared/cronjobs";
import type { ScheduledResearchItem } from "../../../../../shared/scheduledResearch";

/** Which subsystem owns a row. Named `source`, not `kind`, because
 *  `ScheduledResearchItem` already has a `kind` meaning something narrower. */
export type ScheduleSource = "monitor" | "digest" | "launch" | "agent";

export interface ScheduleRow {
  id: string;
  source: ScheduleSource;
  label: string;
  /** Human cadence ("Every day at 07:00", "0 7 * * *") — always present. */
  cadence: string;
  enabled: boolean;
  /** Epoch ms, or null when the source does not publish a next run. */
  nextRunAt: number | null;
  /** Epoch ms; 0/null both mean "never ran". */
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  /** Paused rows are resumable; completed cron jobs are neither. */
  state: "active" | "paused" | "completed";
  /** Only gateway cron jobs can be fired on demand from this surface. */
  canRunNow: boolean;
  canDelete: boolean;
}

/** Epoch ms from an ISO string, or null when absent/unparseable. */
export function epochFromIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = new Date(iso).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

export function rowFromResearch(
  item: ScheduledResearchItem,
  cadenceText: string,
): ScheduleRow {
  const isDigest = item.kind === "digest";
  return {
    id: item.id,
    source: isDigest ? "digest" : "monitor",
    label: isDigest ? "External sessions" : item.topic,
    cadence: cadenceText,
    enabled: item.enabled,
    nextRunAt: null,
    lastRunAt: item.lastRunAt || null,
    lastStatus: null,
    lastError: item.lastError ?? null,
    state: item.enabled ? "active" : "paused",
    canRunNow: false,
    canDelete: false,
  };
}

export function rowFromLaunch(
  item: AppLaunchSchedule,
  cadenceText: string,
): ScheduleRow {
  return {
    id: item.id,
    source: "launch",
    label: item.label,
    cadence: cadenceText,
    enabled: item.enabled,
    nextRunAt: null,
    lastRunAt: item.lastRunAt || null,
    lastStatus: item.lastStatus ?? null,
    lastError: item.lastError ?? null,
    state: item.enabled ? "active" : "paused",
    canRunNow: false,
    canDelete: false,
  };
}

export function rowFromCron(job: CronJob): ScheduleRow {
  return {
    id: job.id,
    source: "agent",
    label: job.name,
    cadence: job.schedule,
    enabled: job.enabled,
    nextRunAt: epochFromIso(job.next_run_at),
    lastRunAt: epochFromIso(job.last_run_at),
    lastStatus: job.last_status,
    lastError: job.last_error,
    state: job.state,
    canRunNow: job.state !== "completed",
    canDelete: true,
  };
}

/** Soonest first. Rows without a next run sort after those with one — they are
 *  cadence-driven, not "never scheduled", so burying them would be wrong but
 *  so would ranking them ahead of a job with a known time. */
export function sortByNextRun(rows: ScheduleRow[]): ScheduleRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (a.nextRunAt === null && b.nextRunAt === null) {
      return a.label.localeCompare(b.label);
    }
    if (a.nextRunAt === null) return 1;
    if (b.nextRunAt === null) return -1;
    return a.nextRunAt - b.nextRunAt;
  });
  return sorted;
}

/** The next `limit` runs that will actually fire: enabled, not completed, and
 *  with a published time. Today uses this — a paused job is not "coming up". */
export function nextUp(rows: ScheduleRow[], limit: number): ScheduleRow[] {
  const live = rows.filter((row) => {
    if (!row.enabled || row.state !== "active") return false;
    return row.nextRunAt !== null;
  });
  return sortByNextRun(live).slice(0, limit);
}

/** A row is failing when its last run reported an error or a non-ok status. */
export function isFailing(row: ScheduleRow): boolean {
  if (row.lastError) return true;
  if (!row.lastStatus) return false;
  const status = row.lastStatus.toLowerCase();
  return status !== "ok" && status !== "success";
}

/** Absolute wall-clock, e.g. "Jul 26, 07:00". `null`/0 reads as "never". */
export function formatWhen(epochMs: number | null): string {
  if (!epochMs) return "never";
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
