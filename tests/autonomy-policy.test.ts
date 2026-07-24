import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => "",
    getAppPath: () => process.cwd(),
    isPackaged: false,
  },
}));

let home = "";
let work = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "autonomy-home-"));
  work = mkdtempSync(join(tmpdir(), "autonomy-work-"));
  process.env.HERMES_HOME = home;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.HERMES_HOME;
  vi.resetModules();
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

describe("typed autonomy policy", () => {
  it("fails unknown actions closed and records the reason", async () => {
    const { evaluateAutonomyDecision } =
      await import("../src/main/autonomy-policy");
    expect(
      evaluateAutonomyDecision({
        runId: "run-1",
        mode: "SCOPED_AUTOMATION",
        risk: "UNKNOWN",
        action: "mystery-tool",
      }),
    ).toMatchObject({
      allowed: false,
      needsUser: true,
      rule: "unknown-fails-closed",
    });
  });

  it("always allows proven reads and denies every other action in read-only mode", async () => {
    const { evaluateAutonomyDecision } =
      await import("../src/main/autonomy-policy");
    const input = {
      runId: "run-1",
      risk: "READ" as const,
      action: "inspect",
      provenSafeRead: true,
    };
    expect(
      evaluateAutonomyDecision({ ...input, mode: "READ_ONLY" }),
    ).toMatchObject({ allowed: true, rule: "proven-safe-read" });
    expect(
      evaluateAutonomyDecision({ ...input, mode: "SCOPED_AUTOMATION" }),
    ).toMatchObject({ allowed: true, rule: "proven-safe-read" });
    expect(
      evaluateAutonomyDecision({ ...input, mode: "INTERACTIVE" }),
    ).toMatchObject({ allowed: true, rule: "proven-safe-read" });
    expect(
      evaluateAutonomyDecision({
        runId: "run-1",
        mode: "READ_ONLY",
        risk: "UNKNOWN",
        action: "mystery-tool",
      }),
    ).toMatchObject({
      allowed: false,
      needsUser: false,
      rule: "read-only-mode-deny",
    });
  });

  it("does not accept caller-supplied proof of workspace or external authority", async () => {
    const { evaluateAutonomyDecision } =
      await import("../src/main/autonomy-policy");
    const forgedWorkspace = {
      runId: "run-1",
      mode: "SCOPED_AUTOMATION",
      risk: "WRITE_WORKSPACE",
      action: "write",
      targetWithinRunRoot: true,
    } as never;
    const forgedExternal = {
      runId: "run-1",
      mode: "SCOPED_AUTOMATION",
      risk: "EXTERNAL",
      action: "send",
      matchingExternalGrantId: "forged-grant",
    } as never;
    expect(evaluateAutonomyDecision(forgedWorkspace)).toMatchObject({
      allowed: false,
      rule: "workspace-write-needs-scope",
    });
    expect(evaluateAutonomyDecision(forgedExternal)).toMatchObject({
      allowed: false,
      rule: "external-action-needs-exact-grant",
    });
  });

  it("maps safe reads to one-time approval and read-only side effects to denial", async () => {
    const { automaticApprovalChoice } = await import("../src/main/autonomy");
    const { evaluateAutonomyDecision } =
      await import("../src/main/autonomy-policy");
    expect(
      automaticApprovalChoice(
        evaluateAutonomyDecision({
          runId: "run-1",
          mode: "READ_ONLY",
          risk: "READ",
          action: "inspect",
          provenSafeRead: true,
        }),
      ),
    ).toBe("once");
    expect(
      automaticApprovalChoice(
        evaluateAutonomyDecision({
          runId: "run-1",
          mode: "READ_ONLY",
          risk: "EXEC",
          action: "execute",
        }),
      ),
    ).toBe("deny");
    expect(
      automaticApprovalChoice(
        evaluateAutonomyDecision({
          runId: "run-1",
          mode: "INTERACTIVE",
          risk: "EXEC",
          action: "execute",
        }),
      ),
    ).toBeNull();
  });

  it("allows writes only inside a realpath-verified root granted to that run", async () => {
    const root = join(work, "project");
    const other = join(work, "other");
    mkdirSync(root);
    mkdirSync(other);
    const grants = await import("../src/main/autonomy-grants");
    grants.grantRunWritableRoot(
      { runId: "run-1", root, expiresAt: Date.now() + 60_000 },
      "default",
    );

    expect(
      grants.assertRunWritablePath("run-1", join(root, "report.md"), "default"),
    ).toBe(join(realpathSync(root), "report.md"));
    expect(() =>
      grants.assertRunWritablePath("run-2", join(root, "report.md"), "default"),
    ).toThrow(/outside/i);
    expect(() =>
      grants.assertRunWritablePath(
        "run-1",
        join(other, "report.md"),
        "default",
      ),
    ).toThrow(/outside/i);
  });

  it("rejects a symlink escape from a run-scoped root", async () => {
    const root = join(work, "project");
    const outside = join(work, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    const link = join(root, "linked");
    try {
      symlinkSync(outside, link);
    } catch {
      return;
    }
    const grants = await import("../src/main/autonomy-grants");
    grants.grantRunWritableRoot(
      { runId: "run-1", root, expiresAt: Date.now() + 60_000 },
      "default",
    );
    expect(() =>
      grants.assertRunWritablePath("run-1", join(link, "leak.txt"), "default"),
    ).toThrow(/outside/i);
  });

  it("matches external grants by exact run, tool, and target and supports revocation", async () => {
    const grants = await import("../src/main/autonomy-grants");
    const grant = grants.grantExternalAction(
      {
        runId: "run-1",
        toolName: "gmail.send",
        target: "person@example.com",
        expiresAt: Date.now() + 60_000,
      },
      "default",
    );
    expect(
      grants.matchingExternalActionGrant(
        "run-1",
        "gmail.send",
        "person@example.com",
        "default",
      )?.id,
    ).toBe(grant.id);
    expect(
      grants.matchingExternalActionGrant(
        "run-1",
        "gmail.send",
        "other@example.com",
        "default",
      ),
    ).toBeNull();
    expect(grants.revokeAutonomyGrant(grant.id, "default")).toBe(true);
    expect(
      grants.matchingExternalActionGrant(
        "run-1",
        "gmail.send",
        "person@example.com",
        "default",
      ),
    ).toBeNull();
  });

  it("allows an external action only after the main process resolves an exact grant", async () => {
    const grants = await import("../src/main/autonomy-grants");
    const store = await import("../src/main/autonomy-decision-store");
    grants.grantExternalAction(
      {
        runId: "run-1",
        toolName: "gmail.send",
        target: "person@example.com",
        expiresAt: Date.now() + 60_000,
      },
      "default",
    );
    expect(
      store.decideAndRecordAutonomy(
        {
          runId: "run-1",
          mode: "SCOPED_AUTOMATION",
          risk: "EXTERNAL",
          action: "send-email",
          toolName: "gmail.send",
          target: "person@example.com",
        },
        "default",
      ),
    ).toMatchObject({
      allowed: true,
      rule: "exact-expiring-external-grant",
      grantId: expect.any(String),
    });
  });

  it("refuses broad, local-file, shell, and delete grants", async () => {
    const grants = await import("../src/main/autonomy-grants");
    const base = {
      runId: "run-1",
      expiresAt: Date.now() + 60_000,
    };
    expect(() =>
      grants.grantExternalAction(
        { ...base, toolName: "gmail.send", target: "*@example.com" },
        "default",
      ),
    ).toThrow(/exact/i);
    expect(() =>
      grants.grantExternalAction(
        { ...base, toolName: "shell.exec", target: "example.com" },
        "default",
      ),
    ).toThrow(/not allowed/i);
    expect(() =>
      grants.grantExternalAction(
        { ...base, toolName: "gmail.delete", target: "message-1" },
        "default",
      ),
    ).toThrow(/not allowed/i);
    expect(() =>
      grants.grantExternalAction(
        { ...base, toolName: "files.send", target: "/tmp/report.md" },
        "default",
      ),
    ).toThrow(/non-file/i);
    expect(() =>
      grants.grantExternalAction(
        {
          ...base,
          toolName: "gmail.send",
          target: "person@example.com\nBCC:all@example.com",
        },
        "default",
      ),
    ).toThrow(/invalid/i);
  });

  it("records redacted allow and deny decisions in an append-only audit", async () => {
    const store = await import("../src/main/autonomy-decision-store");
    store.decideAndRecordAutonomy(
      {
        runId: "run-1",
        mode: "SCOPED_AUTOMATION",
        risk: "READ",
        action: "inspect",
        command: "cat sk-abcdefghijklmnop",
        provenSafeRead: true,
      },
      "default",
    );
    store.decideAndRecordAutonomy(
      {
        runId: "run-1",
        mode: "SCOPED_AUTOMATION",
        risk: "EXEC",
        action: "terminal",
        command: "rm report.md",
      },
      "default",
    );
    const rows = store.listAutonomyDecisions("run-1", 50, "default");
    expect(rows.map((row) => row.allowed)).toEqual([true, false]);
    expect(JSON.stringify(rows)).not.toContain("sk-abcdefghijklmnop");
  });
});
