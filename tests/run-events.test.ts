import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  HERMES_RUN_EVENT_CONTRACT_VERSION,
  buildHermesRunResumeSnapshot,
  parseHermesRunEvent,
  type HermesRunEvent,
} from "../src/shared/run-events";
import {
  appendDerivedHermesRunEvent,
  appendHermesRunEvent,
  getHermesRunResumeSnapshot,
  listHermesRunEvents,
  resetRunEventStoreCacheForTests,
} from "../src/main/run-event-store";

let home: string;

function event(
  sequence: number,
  kind: HermesRunEvent["kind"],
  payload: Record<string, unknown> = {},
): HermesRunEvent {
  return {
    contractVersion: HERMES_RUN_EVENT_CONTRACT_VERSION,
    eventId: `run-1:${sequence}:${kind}`,
    runId: "run-1",
    sequence,
    kind,
    createdAt: 100 + sequence,
    payload,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "run-events-"));
  process.env.HERMES_HOME = home;
  resetRunEventStoreCacheForTests();
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("Hermes run event contract", () => {
  it("rejects unknown versions and event kinds", () => {
    expect(
      parseHermesRunEvent({ ...event(0, "run.started"), contractVersion: 2 }),
    ).toBeNull();
    expect(
      parseHermesRunEvent({ ...event(0, "run.started"), kind: "run.magic" }),
    ).toBeNull();
  });

  it("persists events idempotently and redacts stored payloads", () => {
    const started = event(0, "run.started", { token: "sk-abcdefghijklmnop" });
    appendHermesRunEvent(started, "default");
    appendHermesRunEvent(started, "default");
    const stored = listHermesRunEvents("run-1", 50, "default");
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored[0].payload)).not.toContain(
      "sk-abcdefghijklmnop",
    );
  });

  it("describes approval resume honestly as upstream-unverified", () => {
    const events = [
      event(0, "run.started"),
      event(1, "run.approval.requested", { requestId: "approval-1" }),
    ];
    expect(buildHermesRunResumeSnapshot("run-1", events)).toMatchObject({
      status: "waiting-attention",
      pendingRequestId: "approval-1",
      resumeCapability: "approval-response",
      upstreamDurability: "unverified",
    });
  });

  it("rebuilds the same snapshot from the durable event log", () => {
    appendHermesRunEvent(event(0, "run.started"), "default");
    appendHermesRunEvent(
      { ...event(1, "run.completed"), sessionId: "session-1" },
      "default",
    );
    expect(getHermesRunResumeSnapshot("run-1", "default")).toMatchObject({
      status: "completed",
      sessionId: "session-1",
      resumeCapability: "session",
    });
  });

  it("moves a live approval back to running after the gateway accepts a response", () => {
    appendHermesRunEvent(event(0, "run.started"), "default");
    appendHermesRunEvent(
      event(1, "run.approval.requested", { requestId: "approval-1" }),
      "default",
    );
    appendDerivedHermesRunEvent(
      "run-1",
      "run.approval.resolved",
      { requestId: "approval-1", choice: "once" },
      "default",
    );

    expect(getHermesRunResumeSnapshot("run-1", "default")).toMatchObject({
      status: "running",
      upstreamDurability: "unverified",
    });
  });

  it("keeps an unresolved approval visible after later progress events", () => {
    const events = [
      event(0, "run.started"),
      event(1, "run.approval.requested", { requestId: "approval-1" }),
      event(2, "run.progress", { message: "still waiting" }),
    ];
    expect(buildHermesRunResumeSnapshot("run-1", events)).toMatchObject({
      status: "waiting-attention",
      pendingRequestId: "approval-1",
    });
  });
});
