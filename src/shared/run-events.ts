export const HERMES_RUN_EVENT_CONTRACT_VERSION = 1 as const;

export const HERMES_RUN_EVENT_KINDS = [
  "run.started",
  "run.progress",
  "run.approval.requested",
  "run.approval.resolved",
  "run.question.requested",
  "run.checkpoint",
  "run.delegation.progress",
  "run.completed",
  "run.failed",
  "run.stopped",
] as const;

export type HermesRunEventKind = (typeof HERMES_RUN_EVENT_KINDS)[number];

export interface HermesRunEvent {
  contractVersion: typeof HERMES_RUN_EVENT_CONTRACT_VERSION;
  eventId: string;
  runId: string;
  sequence: number;
  kind: HermesRunEventKind;
  createdAt: number;
  sessionId?: string;
  payload: Record<string, unknown>;
}

export type HermesRunResumeStatus =
  | "running"
  | "waiting-attention"
  | "completed"
  | "failed"
  | "stopped";

export interface HermesRunResumeSnapshot {
  contractVersion: typeof HERMES_RUN_EVENT_CONTRACT_VERSION;
  runId: string;
  status: HermesRunResumeStatus;
  lastSequence: number;
  sessionId?: string;
  pendingRequestId?: string;
  resumeCapability: "approval-response" | "session" | "none";
  upstreamDurability: "unverified";
  reason: string;
}

const KIND_SET = new Set<string>(HERMES_RUN_EVENT_KINDS);

function nonEmptyString(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 240
  );
}

export function parseHermesRunEvent(value: unknown): HermesRunEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.contractVersion !== HERMES_RUN_EVENT_CONTRACT_VERSION) return null;
  if (!nonEmptyString(event.eventId) || !nonEmptyString(event.runId))
    return null;
  if (!KIND_SET.has(String(event.kind))) return null;
  if (
    typeof event.sequence !== "number" ||
    !Number.isInteger(event.sequence) ||
    event.sequence < 0
  ) {
    return null;
  }
  if (
    typeof event.createdAt !== "number" ||
    !Number.isFinite(event.createdAt)
  ) {
    return null;
  }
  if (event.sessionId !== undefined && !nonEmptyString(event.sessionId))
    return null;
  if (
    !event.payload ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    return null;
  }
  return event as unknown as HermesRunEvent;
}

export function buildHermesRunResumeSnapshot(
  runId: string,
  events: HermesRunEvent[],
): HermesRunResumeSnapshot | null {
  const ordered = events
    .filter((event) => event.runId === runId)
    .sort((a, b) => a.sequence - b.sequence || a.createdAt - b.createdAt);
  const last = ordered.at(-1);
  if (!last) return null;
  const sessionId = [...ordered]
    .reverse()
    .find((event) => event.sessionId)?.sessionId;
  const terminal: Partial<Record<HermesRunEventKind, HermesRunResumeStatus>> = {
    "run.completed": "completed",
    "run.failed": "failed",
    "run.stopped": "stopped",
  };
  const terminalEvent = [...ordered]
    .reverse()
    .find((event) => terminal[event.kind] !== undefined);
  const terminalStatus = terminalEvent
    ? terminal[terminalEvent.kind]
    : undefined;
  if (terminalStatus) {
    return {
      contractVersion: HERMES_RUN_EVENT_CONTRACT_VERSION,
      runId,
      status: terminalStatus,
      lastSequence: last.sequence,
      sessionId,
      resumeCapability:
        terminalStatus === "completed" && sessionId ? "session" : "none",
      upstreamDurability: "unverified",
      reason:
        terminalStatus === "completed" && sessionId
          ? "The completed Hermes session can be continued, but gateway restart durability is not verified by this contract."
          : `The run is ${terminalStatus} and has no live resume action.`,
    };
  }
  const pendingRequest = [...ordered]
    .reverse()
    .find((event, index, reversed) => {
      if (
        event.kind !== "run.approval.requested" &&
        event.kind !== "run.question.requested"
      ) {
        return false;
      }
      const requestId = event.payload.requestId;
      if (typeof requestId !== "string") return true;
      const later = reversed.slice(0, index);
      return !later.some(
        (candidate) =>
          candidate.kind === "run.approval.resolved" &&
          candidate.payload.requestId === requestId,
      );
    });
  if (pendingRequest) {
    const requestId =
      typeof pendingRequest.payload.requestId === "string"
        ? pendingRequest.payload.requestId
        : undefined;
    return {
      contractVersion: HERMES_RUN_EVENT_CONTRACT_VERSION,
      runId,
      status: "waiting-attention",
      lastSequence: last.sequence,
      sessionId,
      pendingRequestId: requestId,
      resumeCapability: requestId ? "approval-response" : "none",
      upstreamDurability: "unverified",
      reason: requestId
        ? "The desktop can answer this approval while the gateway run is alive; restart-safe upstream resume is not verified."
        : "The run needs attention but did not provide an addressable request id.",
    };
  }
  if (ordered.some((event) => event.kind === "run.approval.resolved")) {
    return {
      contractVersion: HERMES_RUN_EVENT_CONTRACT_VERSION,
      runId,
      status: "running",
      lastSequence: last.sequence,
      sessionId,
      resumeCapability: sessionId ? "session" : "none",
      upstreamDurability: "unverified",
      reason:
        "The approval response was accepted by the live gateway; restart-safe continuation remains unverified.",
    };
  }
  return {
    contractVersion: HERMES_RUN_EVENT_CONTRACT_VERSION,
    runId,
    status: "running",
    lastSequence: last.sequence,
    sessionId,
    resumeCapability: sessionId ? "session" : "none",
    upstreamDurability: "unverified",
    reason: sessionId
      ? "A session id exists, but restart-safe upstream resume is not verified."
      : "The run is active and has not published a durable session id.",
  };
}
