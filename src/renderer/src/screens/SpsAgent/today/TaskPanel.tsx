// TaskPanel.tsx — the today/next task list.
//
// Extracted verbatim in behaviour from journal/MyWorkSurface.tsx's
// WorkTaskPanel so Today and Work render the SAME component rather than two
// drifting copies. MyWorkSurface imports it from here.
import { useMemo } from "react";
import { useStore } from "../store";
import { useVaultQuery } from "../hooks/useNoteIndex";
import { vaultRowToTask } from "../tasks/vaultRowToTask";
import { TASKS_DB_FOLDER } from "../tasks/taskStorage";
import type { Task } from "../types";
import { localDateKey, splitTasks } from "./todayModel";

export function TaskPanel({
  mode,
  /** Cap the list; Today shows a preview, Work shows everything. */
  limit,
  /** Override the section heading. The Today SURFACE is already titled
   *  "Today", so a section also called "Today" reads as a stutter; inside
   *  Work, where this is a tab, "Today" is the right word. */
  heading,
}: {
  mode: "today" | "next";
  limit?: number;
  heading?: string;
}): React.JSX.Element {
  const setOpenTask = useStore((state) => state.setOpenTask);
  const { rows } = useVaultQuery(TASKS_DB_FOLDER);
  const today = localDateKey();
  const tasks = useMemo(() => rows.map(vaultRowToTask), [rows]);
  const split = useMemo(() => splitTasks(tasks, today), [tasks, today]);
  const all = mode === "today" ? split.today : split.next;
  const visible = limit ? all.slice(0, limit) : all;
  const hidden = all.length - visible.length;

  return (
    <section className="work-task-panel" aria-labelledby={`work-${mode}-title`}>
      <div className="work-rule-head">
        <div>
          <h2 id={`work-${mode}-title`}>
            {heading ?? (mode === "today" ? "Today" : "Next")}
          </h2>
          <p>
            {mode === "today"
              ? "In progress, blocked, in review, or due today."
              : "Open tasks without an immediate status or due date."}
          </p>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="work-task-empty">
          {mode === "today"
            ? "Nothing needs attention today."
            : "No next tasks queued."}
        </p>
      ) : (
        <ul className="work-task-list">
          {visible.map((task: Task) => (
            <li key={task.id}>
              <button type="button" onClick={() => setOpenTask(task)}>
                <span className={`dot s-${task.status}`} aria-hidden="true" />
                <span>{task.title || "Untitled task"}</span>
                <small>{task.due || task.status.replaceAll("_", " ")}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="work-task-empty">
          {hidden} more not shown{mode === "today" ? "" : " here"}.
        </p>
      )}
    </section>
  );
}
