import { describe, expect, it } from "vitest";
import {
  CAPTURE_KINDS,
  TRIAGE_CHIP_CLASS,
  FEEDBACK_ACTIONS,
  assistantReplyText,
  changesetToProposal,
  feedbackConfirmation,
  schemaForCaptureKind,
  timeLabel,
  type Changeset,
} from "./inboxModel";

describe("schemaForCaptureKind", () => {
  it("maps note to no schema and every other kind to itself", () => {
    expect(schemaForCaptureKind("note")).toBeUndefined();
    for (const kind of CAPTURE_KINDS.filter((k) => k !== "note")) {
      expect(schemaForCaptureKind(kind)).toBe(kind);
    }
  });
});

describe("feedbackConfirmation", () => {
  it("produces per-action copy naming the sender", () => {
    expect(feedbackConfirmation("always-capture-sender", "a@b.c")).toContain(
      "a@b.c",
    );
    expect(feedbackConfirmation("ignore-sender", "a@b.c")).toContain("ignore");
    expect(feedbackConfirmation("not-relevant", "a@b.c")).toContain(
      "not relevant",
    );
    expect(feedbackConfirmation("raise-priority", "a@b.c")).toContain(
      "priority",
    );
  });

  it("covers every action surfaced in the UI list", () => {
    for (const { action } of FEEDBACK_ACTIONS) {
      expect(feedbackConfirmation(action, "a@b.c")).toBeTruthy();
    }
  });
});

describe("changesetToProposal", () => {
  const changeset: Changeset = {
    summary: "2 pages, 1 capture, 1 memory",
    pages: [
      { op: "create", pageId: "p1", title: "Page One", markdown: "# One" },
      { op: "update", pageId: "p2", title: "Page Two", markdown: "# Two" },
    ],
    captures: [{ id: "c1", status: "processed" }],
    memory: ["likes espresso"],
  };

  it("maps pages, captures, and memory into ordered operations", () => {
    const proposal = changesetToProposal(changeset, "inbox", "Process inbox");
    expect(proposal.source).toBe("inbox");
    expect(proposal.title).toBe("Process inbox");
    expect(proposal.summary).toBe(changeset.summary);
    expect(proposal.operations.map((op) => op.kind)).toEqual([
      "upsert-page",
      "upsert-page",
      "mark-capture",
      "add-memory",
    ]);
    expect(proposal.operations.map((op) => op.id)).toEqual([
      "page-p1",
      "page-p2",
      "capture-c1",
      "memory-0",
    ]);
  });

  it("handles an empty changeset without operations", () => {
    const proposal = changesetToProposal(
      { summary: "", pages: [], captures: [], memory: [] },
      "inbox",
      "t",
    );
    expect(proposal.operations).toEqual([]);
  });
});

describe("timeLabel", () => {
  it("returns empty for non-numbers and a readable stamp for numbers", () => {
    expect(timeLabel(undefined)).toBe("");
    expect(timeLabel("2026-07-18")).toBe("");
    expect(timeLabel(0)).toBeTruthy();
    expect(timeLabel(Date.now())).toBeTruthy();
  });
});

describe("assistantReplyText", () => {
  it("joins reply arrays with blank lines", () => {
    expect(assistantReplyText({ reply: ["a", "b"] })).toBe("a\n\nb");
  });

  it("passes strings through and stringifies other shapes", () => {
    expect(assistantReplyText("plain")).toBe("plain");
    expect(assistantReplyText({ noReply: true })).toBe(
      JSON.stringify({ noReply: true }, null, 2),
    );
  });
});

describe("TRIAGE_CHIP_CLASS", () => {
  it("maps all five triage labels onto existing chip variants", () => {
    for (const label of [
      "urgent",
      "action",
      "knowledge",
      "archive",
      "ignore",
    ]) {
      expect(TRIAGE_CHIP_CLASS[label]).toBeTruthy();
    }
  });
});
