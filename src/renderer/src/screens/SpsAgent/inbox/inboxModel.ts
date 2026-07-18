// inboxModel.ts — pure helpers for the capture inbox surface (extracted from
// InboxSurface.tsx). No React, no IPC, no store: capture-kind mapping, triage
// chip classes, email-feedback copy, and the ingest-changeset → vault-proposal
// mapping. Unit-tested in inboxModel.test.ts.
import type { VaultProposalInput } from "../../../../../shared/sps-types";
import type {
  SpsCaptureKind,
  SpsPageSchemaKey,
} from "../../../../../shared/sps-types";
import type { EmailMonitorFeedbackAction } from "../../../../../shared/email-monitor";

export const CAPTURE_KINDS: SpsCaptureKind[] = [
  "note",
  "source",
  "project",
  "person",
  "decision",
  "meeting",
  "task",
  "journal",
];

export function schemaForCaptureKind(
  kind: SpsCaptureKind,
): SpsPageSchemaKey | undefined {
  return kind === "note" ? undefined : kind;
}

// Map the 5 triage labels onto the existing SPS chip variants (home.css) —
// no new color tokens; dark mode comes with the .chip filter for free.
export const TRIAGE_CHIP_CLASS: Record<string, string> = {
  urgent: "p-high",
  action: "p-med",
  knowledge: "s-review",
  archive: "s-todo",
  ignore: "s-todo",
};

export const FEEDBACK_ACTIONS: Array<{
  action: EmailMonitorFeedbackAction;
  title: string;
}> = [
  { action: "always-capture-sender", title: "Always capture sender" },
  { action: "raise-priority", title: "Raise priority" },
  { action: "not-relevant", title: "Not relevant" },
  { action: "ignore-sender", title: "Ignore sender" },
];

export function feedbackConfirmation(
  action: EmailMonitorFeedbackAction,
  sender: string,
): string {
  switch (action) {
    case "always-capture-sender":
      return `Will always capture mail from ${sender}.`;
    case "ignore-sender":
      return `Will ignore mail from ${sender}.`;
    case "not-relevant":
      return `Marked not relevant — future mail from ${sender} is skipped.`;
    case "raise-priority":
      return `Raised priority for ${sender}.`;
  }
}

export interface ProposedPage {
  op: "create" | "update";
  pageId: string;
  title: string;
  markdown: string;
}
export interface Changeset {
  summary: string;
  pages: ProposedPage[];
  captures: Array<{ id: string; status: "processed" | "discarded" }>;
  memory: string[];
}

export function changesetToProposal(
  changeset: Changeset,
  source: VaultProposalInput["source"],
  title: string,
): VaultProposalInput {
  return {
    source,
    title,
    summary: changeset.summary,
    operations: [
      ...changeset.pages.map((page) => ({
        id: `page-${page.pageId}`,
        kind: "upsert-page" as const,
        pageId: page.pageId,
        title: page.title,
        markdown: page.markdown,
      })),
      ...changeset.captures.map((capture) => ({
        id: `capture-${capture.id}`,
        kind: "mark-capture" as const,
        captureId: capture.id,
        status: capture.status,
      })),
      ...changeset.memory.map((body, index) => ({
        id: `memory-${index}`,
        kind: "add-memory" as const,
        body,
      })),
    ],
  };
}

export function timeLabel(capturedAt: unknown): string {
  if (typeof capturedAt !== "number") return "";
  try {
    return new Date(capturedAt).toLocaleString();
  } catch {
    return "";
  }
}

export function assistantReplyText(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "reply" in result &&
    Array.isArray((result as { reply?: unknown }).reply)
  ) {
    return (result as { reply: unknown[] }).reply.map(String).join("\n\n");
  }
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}
