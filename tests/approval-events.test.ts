import { describe, it, expect } from "vitest";
import {
  initApprovalState,
  enqueueApproval,
  resolveApproval,
  remainingSeconds,
  type PendingApproval,
} from "../src/renderer/src/lib/approval";

describe("remainingSeconds", () => {
  const t0 = 1_000_000;
  it("is null when the timeout is disabled (0 or negative)", () => {
    expect(remainingSeconds(t0, t0, 0)).toBeNull();
    expect(remainingSeconds(t0, t0, -5)).toBeNull();
  });
  it("is null when the request has no enqueue stamp", () => {
    expect(remainingSeconds(undefined, t0, 60)).toBeNull();
  });
  it("counts down and floors at zero (never negative)", () => {
    expect(remainingSeconds(t0, t0, 60)).toBe(60);
    expect(remainingSeconds(t0, t0 + 10_000, 60)).toBe(50);
    expect(remainingSeconds(t0, t0 + 60_000, 60)).toBe(0);
    expect(remainingSeconds(t0, t0 + 90_000, 60)).toBe(0);
  });
  it("rounds up partial seconds so the badge shows whole seconds", () => {
    expect(remainingSeconds(t0, t0 + 500, 60)).toBe(60);
    expect(remainingSeconds(t0, t0 + 1500, 60)).toBe(59);
  });
});

const req = (over: Partial<PendingApproval> = {}): PendingApproval => ({
  id: "a1",
  command: "rm -rf /tmp/x",
  patternKey: "rm_recursive",
  ...over,
});

describe("enqueueApproval", () => {
  it("queues a fresh request", () => {
    const { state } = enqueueApproval(initApprovalState(), req());
    expect(state.queue).toHaveLength(1);
  });

  it("ignores duplicate ids", () => {
    let s = initApprovalState();
    s = enqueueApproval(s, req()).state;
    s = enqueueApproval(s, req()).state;
    expect(s.queue).toHaveLength(1);
  });
});

describe("resolveApproval", () => {
  it("removes the request and returns the choice", () => {
    const base = enqueueApproval(initApprovalState(), req()).state;
    const { state, response } = resolveApproval(base, "a1", "once");
    expect(response).toEqual({ id: "a1", choice: "once" });
    expect(state.queue).toHaveLength(0);
  });

  it("is idempotent for an unknown id (gateway may have timed out)", () => {
    const { response, state } = resolveApproval(
      initApprovalState(),
      "ghost",
      "deny",
    );
    expect(response).toEqual({ id: "ghost", choice: "deny" });
    expect(state.queue).toEqual([]);
  });
});
