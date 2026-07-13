// taskUtils.ts — view/sort tables + due-date parsing. Ported from tasks.jsx.
import type { IconName } from "../components/iconPaths";
import type { DbView, PrioKey } from "../types";

export const VIEWS: [DbView, string, IconName][] = [
  ["board", "Board", "board"],
  ["table", "Table", "table"],
  ["list", "List", "list"],
  ["gallery", "Gallery", "callout"],
  ["calendar", "Calendar", "calendar"],
];

export const SORTS: [string, string][] = [
  ["manual", "Manual"],
  ["due", "Due date"],
  ["prio", "Priority"],
  ["title", "Name"],
];

export const PRIO_RANK: Record<PrioKey, number> = { high: 0, med: 1, low: 2 };

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

export function parseDueParts(
  due: string,
): { mon: number; day: number } | null {
  const iso = /^\d{4}-(\d{2})-(\d{2})$/.exec(due.trim());
  if (iso) {
    const mon = Number(iso[1]) - 1;
    const day = Number(iso[2]);
    const candidate = new Date(2000, mon, day);
    if (candidate.getMonth() === mon && candidate.getDate() === day) {
      return { mon, day };
    }
    return null;
  }
  const match = /^([a-z]{3})\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i.exec(
    due.trim(),
  );
  if (!match) return null;
  const mon = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  if (mon === undefined || day < 1 || day > 31) return null;
  return { mon, day };
}

/** Normalize the due-date formats accepted by Task Drawer to a local date key. */
export function dueDateKey(due: string, fallbackYear: number): string | null {
  const trimmed = due.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]) - 1;
    day = Number(iso[3]);
  } else {
    const human = /^([a-z]{3})\s+(\d{1,2})(?:,?\s+(\d{4}))?$/i.exec(
      trimmed,
    );
    if (!human) return null;
    const parsedMonth = MONTHS[human[1].toLowerCase()];
    if (parsedMonth === undefined) return null;
    year = human[3] ? Number(human[3]) : fallbackYear;
    month = parsedMonth;
    day = Number(human[2]);
  }
  const candidate = new Date(year, month, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDue(due: string): number {
  const p = parseDueParts(due);
  return p ? p.mon * 100 + p.day : 9999;
}
