import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { HumanAttentionCreateInput } from "../src/shared/human-attention";

let home: string;
let attention: typeof import("../src/main/human-attention");

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "human-attention-"));
  process.env.HERMES_HOME = home;
  vi.resetModules();
  attention = await import("../src/main/human-attention");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function input(key = "run-1:failed"): HumanAttentionCreateInput {
  return {
    kind: "failed-run" as const,
    source: "active-work",
    title: "Run failed",
    summary: "The scheduled run could not finish.",
    idempotencyKey: key,
    runId: "run-1",
    choices: [
      { id: "retry", label: "Retry", tone: "primary" as const },
      { id: "dismiss", label: "Dismiss" },
    ],
  };
}

describe("durable human attention store", () => {
  it("persists a sanitized pending item", async () => {
    const created = await attention.createHumanAttentionItem(
      input(),
      "default",
    );
    expect(created.status).toBe("pending");
    expect(created.contractVersion).toBe(1);
    expect(created.profile).toBe("default");
    expect(await attention.listHumanAttentionItems({}, "default")).toEqual([
      created,
    ]);
  });

  it("deduplicates concurrent creates by idempotency key", async () => {
    const [first, second] = await Promise.all([
      attention.createHumanAttentionItem(input(), "default"),
      attention.createHumanAttentionItem(input(), "default"),
    ]);
    expect(second.id).toBe(first.id);
    expect(await attention.listHumanAttentionItems({}, "default")).toHaveLength(
      1,
    );
  });

  it("resolves exactly once and returns the winning resolution", async () => {
    const created = await attention.createHumanAttentionItem(
      input(),
      "default",
    );
    const [first, second] = await Promise.all([
      attention.resolveHumanAttentionItem(
        created.id,
        { choiceId: "retry" },
        "default",
      ),
      attention.resolveHumanAttentionItem(
        created.id,
        { choiceId: "dismiss" },
        "default",
      ),
    ]);
    const winner = [first, second].find(
      (result) => result.alreadyResolved === false,
    );
    const follower = [first, second].find(
      (result) => result.alreadyResolved === true,
    );
    expect(winner?.ok).toBe(true);
    expect(follower?.item?.resolution?.choiceId).toBe(
      winner?.item?.resolution?.choiceId,
    );
    expect(await attention.listHumanAttentionItems({}, "default")).toEqual([]);
  });

  it("rejects a choice that was not declared by the producer", async () => {
    const created = await attention.createHumanAttentionItem(
      input(),
      "default",
    );
    const result = await attention.resolveHumanAttentionItem(
      created.id,
      { choiceId: "approve-everything" },
      "default",
    );
    expect(result).toMatchObject({
      ok: false,
      error: "Unknown attention choice.",
    });
  });

  it("rejects malformed choice, resume, and resolver values from IPC-shaped input", async () => {
    await expect(
      attention.createHumanAttentionItem(
        {
          ...input("bad-tone"),
          choices: [{ id: "yes", label: "Yes", tone: "unlimited" }],
        } as never,
        "default",
      ),
    ).rejects.toThrow(/tone/);
    await expect(
      attention.createHumanAttentionItem(
        {
          ...input("bad-resume"),
          resume: { kind: "shell", ref: "run-1" },
        } as never,
        "default",
      ),
    ).rejects.toThrow(/resume kind/);
    const created = await attention.createHumanAttentionItem(
      input("bad-resolver"),
      "default",
    );
    expect(
      await attention.resolveHumanAttentionItem(
        created.id,
        { choiceId: "retry", resolvedBy: "remote-admin" } as never,
        "default",
      ),
    ).toMatchObject({ ok: false, error: "Unknown attention resolver." });
  });

  it("expires pending items durably", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValueOnce(now);
    await attention.createHumanAttentionItem(
      { ...input("expires"), expiresAt: now + 100 },
      "default",
    );
    vi.spyOn(Date, "now").mockReturnValue(now + 101);
    expect(await attention.listHumanAttentionItems({}, "default")).toEqual([]);
    const all = await attention.listHumanAttentionItems(
      { status: "all" },
      "default",
    );
    expect(all[0]).toMatchObject({
      status: "expired",
      resolution: { choiceId: "expired" },
    });
  });

  it("does not resolve an item after its expiry", async () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValueOnce(now);
    const created = await attention.createHumanAttentionItem(
      { ...input("expire-on-resolve"), expiresAt: now + 100 },
      "default",
    );
    vi.spyOn(Date, "now").mockReturnValue(now + 101);
    const result = await attention.resolveHumanAttentionItem(
      created.id,
      { choiceId: "retry" },
      "default",
    );
    expect(result).toMatchObject({
      ok: true,
      alreadyResolved: true,
      item: { status: "expired", resolution: { choiceId: "expired" } },
    });
  });

  it("reconstructs a missing approval item from the durable run-event log", async () => {
    const runEvents = await import("../src/main/run-event-store");
    runEvents.appendHermesRunEvent(
      {
        contractVersion: 1,
        eventId: "run-approval:0:started",
        runId: "run-approval",
        sequence: 0,
        kind: "run.started",
        createdAt: 1,
        payload: {},
      },
      "default",
    );
    runEvents.appendHermesRunEvent(
      {
        contractVersion: 1,
        eventId: "run-approval:1:approval",
        runId: "run-approval",
        sequence: 1,
        kind: "run.approval.requested",
        createdAt: 2,
        payload: {
          requestId: "request-1",
          description: "Allow access to the selected file.",
        },
      },
      "default",
    );

    const rows = await attention.listHumanAttentionItems({}, "default");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "approval",
      runId: "run-approval",
      requestId: "request-1",
      summary: "Allow access to the selected file.",
      choices: [
        { id: "once", label: "Allow once" },
        { id: "deny", label: "Deny" },
      ],
    });
  });
});
