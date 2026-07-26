// todayModel.ts — the pure derivations behind the Today surface.
//
// `localDateKey` and `taskNeedsAttentionToday` were previously defined inside
// journal/MyWorkSurface.tsx. They live here now because Today needs them and a
// second copy is exactly how this codebase grew three copies of the cron-brief
// machine — MyWorkSurface re-exports them from here rather than keeping its own.
import type { Task } from "../types";
import type { VaultRow } from "../hooks/useNoteIndex";
import { dueDateKey } from "../tasks/taskUtils";

/** Today in LOCAL time as YYYY-MM-DD.
 *
 *  Local, not UTC, and deliberately so: a UTC key rolls over at 05:30 IST, so
 *  an owner in India reading their brief before lunch would be handed
 *  yesterday's date. (`daily-brief.ts` has this bug; do not copy it here.) */
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The page id the engine is instructed to write its brief to
 *  (`owner-daily-brief.ts:64` pins this format — keep the two in step). */
export function dailyBriefPageId(dateKey: string): string {
  return `daily-brief-${dateKey}`;
}

/** True when a task wants attention today: it is in motion, it is stuck, or it
 *  is due on/before today. */
export function taskNeedsAttentionToday(task: Task, today: string): boolean {
  if (["doing", "review", "blocked"].includes(task.status)) return true;
  const due = dueDateKey(task.due, Number(today.slice(0, 4)));
  return Boolean(due && due <= today);
}

/** True when a task is past its due date — a strictly stronger claim than
 *  `taskNeedsAttentionToday`, which also catches merely in-progress work. */
export function isOverdue(task: Task, today: string): boolean {
  const due = dueDateKey(task.due, Number(today.slice(0, 4)));
  return Boolean(due && due < today);
}

export interface TaskSplit {
  /** Wants attention today. */
  today: Task[];
  /** Open, but nothing forces it to be today. */
  next: Task[];
}

/** Split open tasks into today/next. Done tasks are dropped entirely — Today
 *  answers "what needs me", and finished work never does. */
export function splitTasks(tasks: Task[], today: string): TaskSplit {
  const open = tasks.filter((task) => task.status !== "done");
  const split: TaskSplit = { today: [], next: [] };
  for (const task of open) {
    if (taskNeedsAttentionToday(task, today)) split.today.push(task);
    else split.next.push(task);
  }
  return split;
}

/** Captures still waiting on triage. `processing` counts as waiting: the run
 *  may have died, and a stuck row the owner cannot see is the failure mode
 *  this whole surface exists to prevent. */
export function untriagedCount(rows: VaultRow[]): number {
  return rows.filter((row) => {
    const status = row.props?.status;
    if (typeof status !== "string") return true;
    return status === "unprocessed" || status === "processing";
  }).length;
}

/** The most recent brief page id in the vault, or null if none exists.
 *  Used to say "the last brief was Thursday" instead of a bare empty card. */
export function latestBriefDate(pageIds: string[]): string | null {
  const dates = pageIds
    .filter((id) => id.startsWith("daily-brief-"))
    .map((id) => id.slice("daily-brief-".length))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (dates.length === 0) return null;
  dates.sort();
  return dates[dates.length - 1];
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative = `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00`);
  const end = Date.parse(`${to}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}
