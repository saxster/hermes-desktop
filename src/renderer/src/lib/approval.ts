/**
 * Approval queue state machine (idea B1) — pure core.
 *
 * The gateway emits `approval.request` for dangerous commands and resolves them
 * via `POST /v1/runs/{run_id}/approval`. The gateway supports broader choices,
 * but the desktop deliberately exposes only once|deny. This module models the
 * desktop-side queue: enqueue requests, resolve a one-time choice, and
 * default-deny on an opt-in timeout. It deliberately has
 * no remembered-safe state; durable authority belongs to the typed, expiring
 * main-process grant engine.
 *
 * Pure + testable; the IPC reply + UI live elsewhere.
 */

export type ApprovalChoice = "once" | "deny";

export interface PendingApproval {
  id: string;
  command?: string;
  toolName?: string;
  patternKey?: string;
  description?: string;
  /** Epoch ms the request was enqueued (stamped desktop-side, for countdown). */
  enqueuedAt?: number;
}

export interface ApprovalState {
  queue: PendingApproval[];
}

export function initApprovalState(): ApprovalState {
  return { queue: [] };
}

export interface EnqueueResult {
  state: ApprovalState;
}

/**
 * Add a request to the queue. Duplicate ids are ignored.
 */
export function enqueueApproval(
  state: ApprovalState,
  req: PendingApproval,
): EnqueueResult {
  if (state.queue.some((q) => q.id === req.id)) return { state };
  return { state: { ...state, queue: [...state.queue, req] } };
}

export interface ResolveResult {
  state: ApprovalState;
  /** The response to send to the gateway. */
  response: { id: string; choice: ApprovalChoice };
}

/**
 * Resolve a queued request with a one-time choice. Resolving an unknown id
 * still returns a response (idempotent — the gateway may have timed it out).
 */
export function resolveApproval(
  state: ApprovalState,
  id: string,
  choice: ApprovalChoice,
): ResolveResult {
  const queue = state.queue.filter((q) => q.id !== id);
  return { state: { queue }, response: { id, choice } };
}

/**
 * Seconds left before a pending approval auto-denies, or null when the timeout
 * is disabled (0/negative) or the request has no enqueue stamp. Pure; the UI
 * uses it for the countdown and the hook uses it to fire the auto-deny.
 */
export function remainingSeconds(
  enqueuedAt: number | undefined,
  now: number,
  timeoutSeconds: number,
): number | null {
  if (!timeoutSeconds || timeoutSeconds <= 0) return null;
  if (enqueuedAt === undefined) return null;
  const elapsed = (now - enqueuedAt) / 1000;
  return Math.max(0, Math.ceil(timeoutSeconds - elapsed));
}
