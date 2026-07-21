// property-autofill.ts — shared types + pure helpers for "autofill, not data
// entry": the AI watches context mentioning an entity and PROPOSES property
// updates (never writes them), which the owner approves in the AI Review
// Queue via update-frontmatter operations. Pure + dependency-free.

export const AUTOFILL_SCHEMAS = ["person", "project"] as const;
export type AutofillSchema = (typeof AUTOFILL_SCHEMAS)[number];

/** Folder-backed entity rows the v1 proposer supports. */
export const AUTOFILL_FOLDERS: Record<AutofillSchema, string> = {
  person: "people",
  project: "projects",
};

/**
 * Keys the proposer may suggest, per schema. Every key must be patchable by
 * sps-update-page-properties — i.e. NOT in its RESERVED_KEYS (title, icon,
 * cover, source, ingestedAt, journal, date, time, mood, tags).
 */
export const AUTOFILLABLE_PROPERTIES: Record<AutofillSchema, string[]> = {
  person: ["organization", "email", "phone", "followUpAt"],
  project: ["status", "nextStep", "due", "prio"],
};

const MAX_UPDATES = 6;
const MAX_VALUE_CHARS = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIO_VALUES = new Set(["high", "med", "low"]);

export interface PropertyAutofillUpdate {
  key: string;
  value: string | number;
}

export interface PropertyAutofillResult {
  created: boolean;
  proposalId?: string;
  updates?: number;
  /** not-found | no-context | nothing-new | unsupported */
  reason?: string;
}

function coerceValue(key: string, raw: unknown): string | number | null {
  if (key === "followUpAt") {
    // Person follow-ups are epoch ms; accept YYYY-MM-DD from the model.
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
    if (typeof raw === "string" && DATE_RE.test(raw.trim())) {
      const ms = Date.parse(`${raw.trim()}T09:00:00`);
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  }
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, MAX_VALUE_CHARS);
  if (!value) return null;
  if (key === "prio" && !PRIO_VALUES.has(value.toLowerCase())) return null;
  if (key === "due" && !DATE_RE.test(value)) return null;
  if (key === "prio") return value.toLowerCase();
  return value;
}

function currentEquals(
  current: unknown,
  key: string,
  value: string | number,
): boolean {
  if (current == null) return false;
  if (key === "followUpAt") {
    const ms =
      typeof current === "number"
        ? current
        : typeof current === "string" && DATE_RE.test(current.trim())
          ? Date.parse(`${current.trim()}T09:00:00`)
          : NaN;
    return ms === value;
  }
  return String(current).trim() === String(value).trim();
}

/**
 * Coerce the model's JSON into safe, delta-only updates: allowlisted keys,
 * typed values, anything matching the current value dropped. PURE + total.
 */
export function parsePropertyAutofill(
  raw: unknown,
  schema: AutofillSchema,
  currentProps: Record<string, unknown>,
): PropertyAutofillUpdate[] {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const list = Array.isArray(obj.updates) ? obj.updates : [];
  const allowed = new Set(AUTOFILLABLE_PROPERTIES[schema]);
  const seen = new Set<string>();
  const updates: PropertyAutofillUpdate[] = [];
  for (const item of list) {
    if (updates.length >= MAX_UPDATES) break;
    const record =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (!allowed.has(key) || seen.has(key)) continue;
    const value = coerceValue(key, record.value);
    if (value == null) continue;
    if (currentEquals(currentProps[key], key, value)) continue;
    seen.add(key);
    updates.push({ key, value });
  }
  return updates;
}

/** Resolve a folder name to its autofill schema, or null when unsupported. */
export function autofillSchemaForFolder(folder: string): AutofillSchema | null {
  for (const schema of AUTOFILL_SCHEMAS) {
    if (AUTOFILL_FOLDERS[schema] === folder) return schema;
  }
  return null;
}
