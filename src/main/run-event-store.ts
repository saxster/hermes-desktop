import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import {
  HERMES_RUN_EVENT_CONTRACT_VERSION,
  buildHermesRunResumeSnapshot,
  parseHermesRunEvent,
  type HermesRunEvent,
  type HermesRunResumeSnapshot,
} from "../shared/run-events";
import { redactExternalText } from "./external-context/redact";
import { getActiveProfileNameSync, profileHome } from "./utils";

const RUN_EVENTS_FILE = "run-events.jsonl";
const knownEventIds = new Map<string, Set<string>>();

function logPath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "logs",
    RUN_EVENTS_FILE,
  );
}

function knownFor(path: string): Set<string> {
  const cached = knownEventIds.get(path);
  if (cached) return cached;
  const ids = new Set<string>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = parseHermesRunEvent(JSON.parse(line));
        if (parsed) ids.add(parsed.eventId);
      } catch {
        // Malformed historical rows are ignored; valid later rows remain usable.
      }
    }
  }
  knownEventIds.set(path, ids);
  return ids;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "string") return redactExternalText(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([key, nested]) => [key, sanitize(nested)]),
  );
}

export function appendHermesRunEvent(
  value: unknown,
  profile?: string,
): HermesRunEvent {
  const parsed = parseHermesRunEvent(value);
  if (!parsed) throw new Error("Invalid Hermes run event.");
  const event = parseHermesRunEvent({
    ...parsed,
    payload: sanitize(parsed.payload),
  });
  if (!event) throw new Error("Invalid sanitized Hermes run event.");
  const path = logPath(profile);
  const known = knownFor(path);
  if (known.has(event.eventId)) return event;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  known.add(event.eventId);
  return event;
}

export function appendDerivedHermesRunEvent(
  runId: string,
  kind: HermesRunEvent["kind"],
  payload: Record<string, unknown>,
  profile?: string,
  sessionId?: string,
): HermesRunEvent {
  const prior = listHermesRunEvents(runId, 2_000, profile);
  const sequence =
    prior.reduce((highest, event) => Math.max(highest, event.sequence), -1) + 1;
  return appendHermesRunEvent(
    {
      contractVersion: HERMES_RUN_EVENT_CONTRACT_VERSION,
      eventId: `${runId}:${sequence}:${kind}:${Date.now()}`,
      runId,
      sequence,
      kind,
      createdAt: Date.now(),
      sessionId,
      payload,
    },
    profile,
  );
}

export function listHermesRunEvents(
  runId?: string,
  limit = 500,
  profile?: string,
): HermesRunEvent[] {
  const path = logPath(profile);
  if (!existsSync(path)) return [];
  const events: HermesRunEvent[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = parseHermesRunEvent(JSON.parse(line));
      if (event && (!runId || event.runId === runId)) events.push(event);
    } catch {
      // Skip one corrupt row without hiding the rest of the append-only log.
    }
  }
  return events
    .sort((a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence)
    .slice(-Math.min(Math.max(Math.floor(limit), 1), 2_000));
}

export function listAllHermesRunEvents(profile?: string): HermesRunEvent[] {
  const path = logPath(profile);
  if (!existsSync(path)) return [];
  const events: HermesRunEvent[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = parseHermesRunEvent(JSON.parse(line));
      if (event) events.push(event);
    } catch {
      // One malformed historical row must not hide later valid events.
    }
  }
  return events.sort(
    (a, b) => a.createdAt - b.createdAt || a.sequence - b.sequence,
  );
}

export function getHermesRunResumeSnapshot(
  runId: string,
  profile?: string,
): HermesRunResumeSnapshot | null {
  return buildHermesRunResumeSnapshot(
    runId,
    listHermesRunEvents(runId, 2_000, profile),
  );
}

export function resetRunEventStoreCacheForTests(): void {
  knownEventIds.clear();
}
