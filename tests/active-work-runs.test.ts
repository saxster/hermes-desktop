import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

let home: string;
const PROFILE = "default";
let activeWorkRuns: typeof import("../src/main/active-work-runs");

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "sps-active-work-"));
  process.env.HERMES_HOME = home;
  vi.resetModules();
  activeWorkRuns = await import("../src/main/active-work-runs");
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("active work runs sidecar", () => {
  it("returns [] when no sidecar exists", async () => {
    expect(await activeWorkRuns.listActiveWorkRuns(PROFILE)).toEqual([]);
  });

  it("creates a running SPS work record with criteria", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      {
        source: "sps-work",
        title: "Work: launch plan",
        goal: "Execute the launch plan",
        pageId: "page-1",
        pageTitle: "Launch plan",
        clientRunId: "run-1",
        criteria: [
          { text: "Build it", done: false },
          { text: "Verify it", done: true },
        ],
      },
      PROFILE,
    );

    expect(run.status).toBe("running");
    expect(run.contractVersion).toBe(2);
    expect(run.trigger).toBe("manual");
    expect(run.criteria).toHaveLength(2);
    expect(run.createdAt).toBeGreaterThan(0);
    expect(await activeWorkRuns.listActiveWorkRuns(PROFILE)).toEqual([run]);
  });

  it("rejects malformed renderer inputs instead of persisting invented states or evidence", async () => {
    await expect(
      activeWorkRuns.createActiveWorkRun(
        {
          source: "unknown-source",
          title: "",
          goal: "Work",
        } as never,
        PROFILE,
      ),
    ).rejects.toThrow("Invalid active work input");

    const run = await activeWorkRuns.createActiveWorkRun(
      { source: "goal", title: "Goal", goal: "Work" },
      PROFILE,
    );
    await expect(
      activeWorkRuns.updateActiveWorkRun(
        run.id,
        {
          status: "completed",
          criteria: [
            {
              ...run.criteria[0],
              done: true,
              evidence: {} as never,
            },
          ],
          artifacts: [
            {
              id: "artifact",
              kind: "made-up",
              label: "Proof",
              createdAt: Date.now(),
            } as never,
          ],
        },
        PROFILE,
      ),
    ).rejects.toThrow("Invalid active work patch");
  });

  it("rejects immutable-field injection and malformed scalar patches", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      { source: "goal", title: "Goal", goal: "Work" },
      PROFILE,
    );
    await expect(
      activeWorkRuns.updateActiveWorkRun(
        run.id,
        { id: "forged", source: "cron-job", status: "stopped" } as never,
        PROFILE,
      ),
    ).rejects.toThrow(/id is not supported/);
    await expect(
      activeWorkRuns.updateActiveWorkRun(
        run.id,
        { summary: 42, completedAt: Number.NaN } as never,
        PROFILE,
      ),
    ).rejects.toThrow("Invalid active work patch");
    expect(
      await activeWorkRuns.getActiveWorkRun(run.id, PROFILE),
    ).toMatchObject({
      id: run.id,
      source: "goal",
      status: "running",
    });
  });

  it("updates status, session id, tool, and completion fields", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      {
        source: "goal",
        title: "Goal: fix tests",
        goal: "Fix failing tests",
        clientRunId: "run-2",
        criteria: [{ text: "Tests pass" }],
        expectedArtifacts: [
          { kind: "text", label: "Test result", required: true },
        ],
      },
      PROFILE,
    );

    const criterion = {
      ...run.criteria[0],
      done: true,
      evidence: {
        summary: "Focused tests passed",
        verifiedAt: 122,
        verifiedBy: "system" as const,
      },
    };

    const updated = await activeWorkRuns.updateActiveWorkRun(
      run.id,
      {
        sessionId: "sess-2",
        lastTool: "terminal",
        criteria: [criterion],
        artifacts: [
          {
            id: "artifact-1",
            kind: "text",
            label: "Test result",
            ref: "Tests pass",
            createdAt: 122,
          },
        ],
        status: "completed",
        summary: "Tests pass",
        completedAt: 123,
      },
      PROFILE,
    );

    expect(updated?.sessionId).toBe("sess-2");
    expect(updated?.lastTool).toBe("terminal");
    expect(updated?.status).toBe("completed");
    expect(updated?.summary).toBe("Tests pass");
    expect(updated?.completedAt).toBe(123);
  });

  it("refuses unsupported completion claims", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      { source: "goal", title: "Goal", goal: "Do the thing" },
      PROFILE,
    );
    await expect(
      activeWorkRuns.updateActiveWorkRun(
        run.id,
        { status: "completed", completedAt: Date.now() },
        PROFILE,
      ),
    ).rejects.toThrow("every criterion has evidence");
  });

  it("refuses completion when criterion evidence names a missing artifact", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      { source: "goal", title: "Goal", goal: "Do the thing" },
      PROFILE,
    );
    await expect(
      activeWorkRuns.updateActiveWorkRun(
        run.id,
        {
          status: "completed",
          criteria: [
            {
              ...run.criteria[0],
              done: true,
              evidence: {
                summary: "Verified",
                artifactId: "missing",
                verifiedAt: Date.now(),
                verifiedBy: "system",
              },
            },
          ],
          artifacts: [
            {
              id: "different",
              kind: "text",
              label: "Result",
              createdAt: Date.now(),
            },
          ],
        },
        PROFILE,
      ),
    ).rejects.toThrow("every criterion has evidence");
  });

  it("parks a failed run in Needs Attention", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      {
        source: "assistant-recipe",
        title: "Morning brief",
        goal: "Prepare brief",
      },
      PROFILE,
    );
    const failed = await activeWorkRuns.updateActiveWorkRun(
      run.id,
      { status: "failed", error: "Required skill is missing." },
      PROFILE,
    );
    const { listHumanAttentionItems } =
      await import("../src/main/human-attention");
    const items = await listHumanAttentionItems({}, PROFILE);
    expect(failed?.attentionItemId).toBe(items[0].id);
    expect(items[0]).toMatchObject({
      kind: "failed-run",
      runId: run.id,
      summary: "Required skill is missing.",
    });
  });

  it("recreates a missing Needs Attention row for a durable failed run", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      { source: "assistant-recipe", title: "Brief", goal: "Prepare brief" },
      PROFILE,
    );
    await activeWorkRuns.updateActiveWorkRun(
      run.id,
      { status: "failed", error: "Gateway offline" },
      PROFILE,
    );
    const { profileHome } = await import("../src/main/utils");
    rmSync(join(profileHome(PROFILE), "sps-agent", "human-attention.json"), {
      force: true,
    });
    const [reconciled] = await activeWorkRuns.listActiveWorkRuns(PROFILE);
    const { listHumanAttentionItems } =
      await import("../src/main/human-attention");
    const attention = await listHumanAttentionItems({}, PROFILE);
    expect(attention).toHaveLength(1);
    expect(reconciled.attentionItemId).toBe(attention[0].id);
  });

  it("returns null when updating a missing run", async () => {
    expect(
      await activeWorkRuns.updateActiveWorkRun(
        "missing",
        { status: "stopped" },
        PROFILE,
      ),
    ).toBeNull();
  });

  it("deduplicates a retried producer run by client run id", async () => {
    const input = {
      source: "scheduled-research" as const,
      title: "Research",
      goal: "Check sources",
      clientRunId: "scheduled:one:output.md:123",
    };
    const [first, second] = await Promise.all([
      activeWorkRuns.createActiveWorkRun(input, PROFILE),
      activeWorkRuns.createActiveWorkRun(input, PROFILE),
    ]);
    expect(second.id).toBe(first.id);
    expect(await activeWorkRuns.listActiveWorkRuns(PROFILE)).toHaveLength(1);
  });

  it("reconciles a run stopped before desktop restart from its durable event", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      {
        source: "goal",
        title: "Goal",
        goal: "Do work",
        clientRunId: "restart-stop",
      },
      PROFILE,
    );
    const events = await import("../src/main/run-event-store");
    events.appendHermesRunEvent(
      {
        contractVersion: 1,
        eventId: "restart-stop:0:stopped",
        runId: "restart-stop",
        sequence: 0,
        kind: "run.stopped",
        createdAt: Date.now(),
        payload: { error: "Stopped" },
      },
      PROFILE,
    );

    const [reconciled] =
      await activeWorkRuns.reconcileInterruptedActiveWorkRuns(
        PROFILE,
        run.updatedAt + 1,
      );
    expect(reconciled).toMatchObject({ status: "stopped" });
  });

  it("blocks and parks a run whose terminal state was lost across restart", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      {
        source: "assistant-recipe",
        title: "Daily brief",
        goal: "Prepare a brief",
        clientRunId: "restart-unknown",
      },
      PROFILE,
    );

    const [reconciled] =
      await activeWorkRuns.reconcileInterruptedActiveWorkRuns(
        PROFILE,
        run.updatedAt + 1,
      );
    expect(reconciled).toMatchObject({
      status: "blocked",
      blockerReason: expect.stringContaining("restarted"),
    });
    const { listHumanAttentionItems } =
      await import("../src/main/human-attention");
    expect(await listHumanAttentionItems({}, PROFILE)).toEqual([
      expect.objectContaining({ kind: "blocked-run", runId: run.id }),
    ]);
  });

  it("surfaces corrupt JSON instead of erasing active work tracking", async () => {
    const dir = join(home, "sps-agent");
    mkdirSync(dir, { recursive: true });
    const p = join(dir, "active-work-runs.json");
    writeFileSync(p, "{not json", "utf-8");
    await expect(activeWorkRuns.listActiveWorkRuns(PROFILE)).rejects.toThrow(
      "Active work tracking could not be read",
    );
  });

  it("gets a run by id", async () => {
    const run = await activeWorkRuns.createActiveWorkRun(
      { source: "kanban", title: "Task", goal: "Do task", taskId: "t_123" },
      PROFILE,
    );
    expect(await activeWorkRuns.getActiveWorkRun(run.id, PROFILE)).toEqual(run);
    expect(await activeWorkRuns.getActiveWorkRun("nope", PROFILE)).toBeNull();
  });
});
