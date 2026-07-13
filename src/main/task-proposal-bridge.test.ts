import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { listVaultProposalsIn } from "./vault-review-queue";
import {
  drainTaskProposalSpoolIn,
  taskProposalInput,
} from "./task-proposal-bridge";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "task-proposal-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("task proposal bridge", () => {
  it("maps ONTOLOGY task fields into the current task-row schema", () => {
    const proposal = taskProposalInput({
      requestId: "tg-42",
      title: "Send revised deck",
      body: "Use the approved numbers.",
      due: "2026-07-15",
      priority: "high",
      source: "telegram",
      requestedAt: 123,
    });

    expect(proposal.source).toBe("telegram");
    expect(proposal.operations[0]).toMatchObject({
      kind: "create-task",
      title: "Send revised deck",
    });
    expect(proposal.operations[0]?.diff).toBeUndefined();
    const markdown =
      proposal.operations[0]?.kind === "create-task"
        ? proposal.operations[0].markdown
        : "";
    expect(markdown).toContain('type: "task"');
    expect(markdown).toContain('status: "todo"');
    expect(markdown).toContain('due: "2026-07-15"');
    expect(markdown).toContain('due_date: "2026-07-15"');
  });

  it("drains one valid message into the review queue and deduplicates retries", async () => {
    const root = tempRoot();
    const inbox = join(root, "sps-agent", "task-proposals", "inbox");
    mkdirSync(inbox, { recursive: true });
    const input = {
      requestId: "telegram-message-99",
      title: "Book studio",
      source: "telegram",
    };
    writeFileSync(join(inbox, "one.json"), JSON.stringify(input));

    const first = await drainTaskProposalSpoolIn(root);
    expect(first.created).toHaveLength(1);
    expect((await listVaultProposalsIn(root))[0]?.status).toBe("pending");

    writeFileSync(join(inbox, "retry.json"), JSON.stringify(input));
    const retry = await drainTaskProposalSpoolIn(root);
    expect(retry.created).toHaveLength(0);
    expect(retry.duplicates).toEqual(["telegram-message-99"]);
    expect(await listVaultProposalsIn(root)).toHaveLength(1);
  });

  it("quarantines malformed input without creating a proposal", async () => {
    const root = tempRoot();
    const inbox = join(root, "sps-agent", "task-proposals", "inbox");
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, "bad.json"), "{bad");

    const result = await drainTaskProposalSpoolIn(root);

    expect(result.rejected).toEqual(["bad.json"]);
    expect(
      readFileSync(
        join(root, "sps-agent", "task-proposals", "rejected", "bad.json"),
        "utf-8",
      ),
    ).toBe("{bad");
  });
});
