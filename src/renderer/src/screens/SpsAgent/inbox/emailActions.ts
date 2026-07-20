// emailActions.ts — "Turn into task" for an email capture (ROADMAP "Email
// Actions"). Mirrors the QuickCapture saveTask flow: persist a task row FIRST
// (so nothing is lost if the gateway is slow/down), then classify + route, then
// record the outcome on the row. The task body keeps a typed `source:: [[cap]]`
// backlink to the capture so the note-index graph connects them.
import type { VaultRow } from "../hooks/useNoteIndex";
import { INBOX_FOLDER } from "./capture";
import { TASKS_DB_FOLDER } from "../tasks/taskStorage";
import { rowToMarkdown } from "../editor/rowMarkdown";
import { pageIdFromPath } from "../lib/pageId";
import { parseYamlFrontmatterMarkdown } from "../../../../../shared/sps-frontmatter";
import type {
  RouteTaskInput,
  RouteTaskOutcome,
  TaskTriageResult,
} from "../../../../../shared/tasks-dump";

const MAX_TASK_BODY_CHARS = 3000;

/** The slice of window.hermesAPI this flow needs (injected for tests). */
export interface EmailActionsApi {
  spsReadRow: (
    dbFolder: string,
    rowId: string,
    profile?: string,
  ) => Promise<string | null>;
  spsExportRow: (
    dbFolder: string,
    rowId: string,
    markdown: string,
    profile?: string,
  ) => Promise<boolean>;
  spsClassifyTask: (
    text: string,
    profile?: string,
  ) => Promise<TaskTriageResult>;
  spsRouteTask: (
    input: RouteTaskInput,
    profile?: string,
  ) => Promise<RouteTaskOutcome>;
}

export interface CaptureToTaskResult {
  ok: boolean;
  rowId?: string;
  /** Final task status ("todo"/"doing"/"review"/"inbox" when unrouted). */
  status?: string;
  error?: string;
}

/** Classification text: subject + sender + bounded body. Pure for tests. */
export function taskTextFromCapture(
  title: string,
  from: string,
  body: string,
): string {
  const excerpt = body.trim().slice(0, MAX_TASK_BODY_CHARS);
  const header = from.trim() ? `${title}\n\nFrom: ${from.trim()}` : title;
  return excerpt ? `${header}\n\n${excerpt}` : header;
}

/** Task-row body: the email excerpt plus provenance + capture backlink. */
export function taskBodyFromCapture(
  from: string,
  body: string,
  captureId: string,
): string {
  const excerpt = body.trim().slice(0, MAX_TASK_BODY_CHARS);
  const footer = `—\nFrom: ${from.trim() || "unknown sender"}\nsource:: [[${captureId}]]`;
  return excerpt ? `${excerpt}\n\n${footer}` : footer;
}

/**
 * Convert an email capture into a routed ToDo task. Never throws: a persist or
 * classify failure leaves the task row in "inbox" status instead of losing it.
 */
export async function turnCaptureIntoTask(
  api: EmailActionsApi,
  row: VaultRow,
  profile?: string,
): Promise<CaptureToTaskResult> {
  const captureId = pageIdFromPath(row.path);
  const current = await api.spsReadRow(INBOX_FOLDER, captureId, profile);
  if (current == null) return { ok: false, error: "capture-not-found" };
  const { props, body } = parseYamlFrontmatterMarkdown(current);
  const rawTitle = typeof props.title === "string" ? props.title.trim() : "";
  const title = rawTitle || "Email task";
  const from = typeof props.emailFrom === "string" ? props.emailFrom : "";

  const rowId = `task-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const detail = taskBodyFromCapture(from, body, captureId);
  const saved = await api.spsExportRow(
    TASKS_DB_FOLDER,
    rowId,
    rowToMarkdown({ title, status: "inbox" }, detail),
    profile,
  );
  if (!saved) return { ok: false, error: "task-write-failed" };

  try {
    const triage = await api.spsClassifyTask(
      taskTextFromCapture(title, from, body),
      profile,
    );
    const outcome = await api.spsRouteTask(
      { rowId, title, body: detail, triage },
      profile,
    );
    const nextProps: Record<string, unknown> = {
      title,
      status: outcome.status,
      route: outcome.route,
      assigneeId: triage.assigneeId,
      // Mirror onto `who` so the existing ToDo views render the assignee.
      who: triage.assigneeId,
    };
    if (triage.due) nextProps.due = triage.due;
    // A dispatched AI task only points at the Kanban record; execution state
    // lives there so the ToDo row never drifts from it.
    if (outcome.delegatedTo) nextProps.delegatedTo = outcome.delegatedTo;
    await api.spsExportRow(
      TASKS_DB_FOLDER,
      rowId,
      rowToMarkdown(nextProps, detail),
      profile,
    );
    return { ok: true, rowId, status: outcome.status };
  } catch {
    // Classify/route is best-effort — the captured task survives unrouted.
    return { ok: true, rowId, status: "inbox" };
  }
}
