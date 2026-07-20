// inbox-digest.ts — shared types + pure helpers for the daily inbox digest:
// a once-per-day LLM rollup of the day's triaged email captures into a
// folder-backed `digests/` row, reviewable in the inbox surface. Pure and
// dependency-free so main and the renderer share it and vitest can cover it.

export const INBOX_DIGEST_FOLDER = "digests";
export const INBOX_DIGEST_KIND = "inbox-digest";
export const INBOX_DIGEST_MAX_CAPTURES = 40;
/** Earliest local hour for the automatic daily run (5 PM). */
export const INBOX_DIGEST_HOUR_LOCAL = 17;

export interface InboxDigestCounts {
  total: number;
  action: number;
  newsletters: number;
}

export interface InboxDigestResult {
  ok: boolean;
  id?: string;
  counts?: InboxDigestCounts;
  error?: string;
}

/** Minimal row shape the selector needs (note-index query rows satisfy it). */
export interface DigestCandidateRow {
  path: string;
  props: Record<string, unknown>;
  mtime: number;
}

/** capturedAt as epoch ms; tolerates JSON-stringified numbers. */
export function capturedAtMs(props: Record<string, unknown>): number {
  const raw = props.capturedAt;
  const value = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function isEmailCapture(props: Record<string, unknown>): boolean {
  return props.source === "email";
}

/** Newsletter-lane flag; tolerates the string form older rows carry. */
export function isNewsletterCapture(props: Record<string, unknown>): boolean {
  return props.digest === true || props.digest === "true";
}

/** Local-midnight start of the given date's calendar day, epoch ms. */
export function localDayStartMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local calendar date key (YYYY-MM-DD) — the digest row id suffix. */
export function localDateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** The day's email captures, newest first, capped for the prompt budget. */
export function selectDigestCaptures(
  rows: DigestCandidateRow[],
  dayStartMs: number,
): DigestCandidateRow[] {
  return rows
    .filter((row) => isEmailCapture(row.props))
    .filter((row) => capturedAtMs(row.props) >= dayStartMs)
    .sort((a, b) => capturedAtMs(b.props) - capturedAtMs(a.props))
    .slice(0, INBOX_DIGEST_MAX_CAPTURES);
}
