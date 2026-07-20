// meeting.ts — shared types + pure helpers for meeting transcript intake and
// action-item extraction (transcript → capture → review-queue proposal).
// Pure and dependency-free so main, preload, renderer, and vitest all share it.

// ---------------------------------------------------------------------------
// Transcript parsing: normalize VTT / SRT / plain "Name: text" exports into
// speaker-tagged segments, then into a compact canonical text for the vault.
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  speaker: string;
  text: string;
  ts?: string;
}

export type TranscriptFormat = "vtt" | "srt" | "plain";

const MAX_SEGMENTS = 5000;
const CUE_RE = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->/;
// "Jane Doe: words" — conservative so prose colons don't become speakers.
const SPEAKER_LINE_RE = /^([A-Z][\p{L} .''-]{0,39}?):\s+(\S.*)$/u;
const VOICE_TAG_RE = /^<v(?:\.[^>]*)?\s+([^>]+)>(.*?)<\/v>$/s;

export function detectTranscriptFormat(raw: string): TranscriptFormat {
  if (/^\s*WEBVTT/.test(raw)) return "vtt";
  if (CUE_RE.test(raw)) return raw.includes("WEBVTT") ? "vtt" : "srt";
  return "plain";
}

/** Split "Jane: hello" into {speaker, text}; null when there's no tag. */
function splitSpeakerTag(text: string): { speaker: string; text: string } {
  const voice = VOICE_TAG_RE.exec(text.trim());
  if (voice) {
    const speaker = voice[1].trim();
    const inner = voice[2].trim();
    // Some exports duplicate the voice name as an inner "Name:" prefix.
    const tagged = SPEAKER_LINE_RE.exec(inner);
    if (tagged && namesEqual(tagged[1], speaker)) {
      return { speaker, text: tagged[2].trim() };
    }
    return { speaker, text: inner };
  }
  const tagged = SPEAKER_LINE_RE.exec(text.trim());
  if (tagged) return { speaker: tagged[1].trim(), text: tagged[2].trim() };
  return { speaker: "", text: text.trim() };
}

function namesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function parseCues(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  // Cue formats are block-based: blank-line-separated, with a "-->" cue line.
  const blocks = raw.split(/\r?\n\s*\r?\n/);
  for (const block of blocks) {
    if (segments.length >= MAX_SEGMENTS) break;
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0 || /^WEBVTT/.test(lines[0])) continue;
    const cueIndex = lines.findIndex((line) => CUE_RE.test(line));
    if (cueIndex === -1) continue;
    const ts = /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3})/.exec(
      lines[cueIndex],
    )?.[1];
    const text = lines
      .slice(cueIndex + 1)
      .join(" ")
      .trim();
    if (!text) continue;
    const { speaker, text: clean } = splitSpeakerTag(text);
    segments.push({ speaker, text: clean, ...(ts ? { ts } : {}) });
  }
  return segments;
}

function parsePlain(raw: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (segments.length >= MAX_SEGMENTS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tagged = SPEAKER_LINE_RE.exec(trimmed);
    if (tagged) {
      segments.push({ speaker: tagged[1].trim(), text: tagged[2].trim() });
    } else if (segments.length > 0) {
      segments[segments.length - 1].text += ` ${trimmed}`;
    } else {
      segments.push({ speaker: "", text: trimmed });
    }
  }
  return segments;
}

/** Parse any supported transcript export into speaker-tagged segments. */
export function parseTranscript(
  raw: string,
  format?: TranscriptFormat,
): TranscriptSegment[] {
  const detected = format ?? detectTranscriptFormat(raw);
  if (detected === "plain") return parsePlain(raw);
  return parseCues(raw);
}

/** Canonical capture body: consecutive same-speaker segments merged. */
export function normalizeTranscript(segments: TranscriptSegment[]): string {
  const merged: TranscriptSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.speaker === segment.speaker) {
      last.text += ` ${segment.text}`;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged
    .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
    .join("\n\n");
}

/** Unique speakers in first-seen order (attendee-resolution input). */
export function transcriptSpeakers(segments: TranscriptSegment[]): string[] {
  const seen = new Set<string>();
  const speakers: string[] = [];
  for (const segment of segments) {
    const key = segment.speaker.toLowerCase();
    if (!segment.speaker || seen.has(key)) continue;
    seen.add(key);
    speakers.push(segment.speaker);
  }
  return speakers;
}

// ---------------------------------------------------------------------------
// Import IPC input.
// ---------------------------------------------------------------------------

export interface TranscriptImportInput {
  title?: string;
  content: string;
}

export const MAX_TRANSCRIPT_CHARS = 200_000;

/** Validate + normalize an import; null when it can't become a capture. */
export function normalizeTranscriptImport(
  input: unknown,
): TranscriptImportInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const candidate = input as Partial<TranscriptImportInput>;
  const content =
    typeof candidate.content === "string"
      ? candidate.content.trim().slice(0, MAX_TRANSCRIPT_CHARS)
      : "";
  if (!content) return null;
  const title =
    typeof candidate.title === "string"
      ? candidate.title.trim().slice(0, 200)
      : "";
  return { content, ...(title ? { title } : {}) };
}

// ---------------------------------------------------------------------------
// Extraction: the LLM's JSON output, coerced into a safe shape.
// ---------------------------------------------------------------------------

export interface MeetingActionItem {
  title: string;
  /** Speaker/contact name as written in the transcript, or "" when unclear. */
  who?: string;
  due?: string;
}

export interface MeetingExtraction {
  summary: string;
  decisions: string[];
  actionItems: MeetingActionItem[];
}

const DUE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 30;
const MAX_TEXT = 500;

function cleanLine(value: unknown, max = MAX_TEXT): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Total coercion of the model's JSON: anything malformed degrades to empty. */
export function parseMeetingExtraction(raw: unknown): MeetingExtraction {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const decisions = Array.isArray(obj.decisions)
    ? obj.decisions
        .map((d) => cleanLine(d))
        .filter(Boolean)
        .slice(0, MAX_ITEMS)
    : [];
  const actionItems: MeetingActionItem[] = [];
  if (Array.isArray(obj.actionItems)) {
    for (const item of obj.actionItems.slice(0, MAX_ITEMS)) {
      const record =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : {};
      const title = cleanLine(record.title, 240);
      if (!title) continue;
      const who = cleanLine(record.who, 120);
      const dueRaw = cleanLine(record.due, 10);
      actionItems.push({
        title,
        ...(who ? { who } : {}),
        ...(DUE_RE.test(dueRaw) ? { due: dueRaw } : {}),
      });
    }
  }
  return {
    summary: cleanLine(obj.summary, 4000),
    decisions,
    actionItems,
  };
}

/** Result of the extract IPC (renderer flash messaging keys off `reason`). */
export interface MeetingExtractResult {
  created: boolean;
  proposalId?: string;
  tasks?: number;
  reason?: string;
}

/** Person-shaped minimum for attendee matching (contacts.PersonRef fits). */
export interface MeetingPersonRef {
  id: string;
  name: string;
  aliases?: string[];
}

function namesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Resolve a transcript name to a person id: exact name/alias match first,
 * then an unambiguous first-name match; otherwise null (never guesses).
 */
export function matchPersonId(
  name: string,
  persons: MeetingPersonRef[],
): string | null {
  const wanted = name.trim();
  if (!wanted) return null;
  for (const person of persons) {
    if (namesMatch(wanted, person.name)) return person.id;
    if (person.aliases?.some((alias) => namesMatch(wanted, alias))) {
      return person.id;
    }
  }
  const firstName = wanted.split(/\s+/)[0].toLowerCase();
  const firstNameMatches = persons.filter((person) => {
    const personFirst = person.name.split(/\s+/)[0].toLowerCase();
    return personFirst === firstName;
  });
  return firstNameMatches.length === 1 ? firstNameMatches[0].id : null;
}
