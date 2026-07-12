import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { useStore } from "../store";
import { uid } from "../lib/ids";
import { rowToMarkdown } from "../editor/rowMarkdown";
import { TASKS_DB_FOLDER, taskRowPath } from "../tasks/taskStorage";
import type { Task } from "../types";

const SCRATCHPAD_PAGE_ID = "dashboard_scratchpad";
const RECENT_LIMIT = 5;

export function Dashboard(): React.JSX.Element {
  const meta = useStore((state) => state.meta);
  const scratchpadDoc = useStore((state) => state.docs[SCRATCHPAD_PAGE_ID]);
  const selectPage = useStore((state) => state.selectPage);
  const setSurface = useStore((state) => state.setSurface);
  const setPageDoc = useStore((state) => state.setPageDoc);
  const setTemplatesOpen = useStore((state) => state.setTemplatesOpen);
  const setOpenTask = useStore((state) => state.setOpenTask);
  const [scratchText, setScratchText] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    if (scratchpadDoc?.[0]) {
      setScratchText(scratchpadDoc[0].text || "");
      return;
    }
    setPageDoc(SCRATCHPAD_PAGE_ID, [
      { id: "sp-1", type: "p", text: "" },
    ]);
  }, [scratchpadDoc, setPageDoc]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sps-recent-visited-pages");
      const ids: string[] = stored ? JSON.parse(stored) : [];
      setRecents(
        ids
          .filter((id) => id in meta && id !== SCRATCHPAD_PAGE_ID)
          .slice(0, RECENT_LIMIT),
      );
    } catch {
      setRecents([]);
    }
  }, [meta]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sps-pinned-pages");
      const ids: string[] = stored
        ? JSON.parse(stored)
        : Object.keys(meta)
            .filter((id) => id !== SCRATCHPAD_PAGE_ID && id !== "home")
            .slice(0, 2);
      const valid = ids.filter((id) => id in meta);
      setPinned(valid);
      if (!stored) {
        localStorage.setItem("sps-pinned-pages", JSON.stringify(valid));
      }
    } catch {
      setPinned([]);
    }
  }, [meta]);

  const updateScratchpad = (text: string): void => {
    setScratchText(text);
    setPageDoc(SCRATCHPAD_PAGE_ID, [
      { id: "sp-1", type: "p", text },
    ]);
    void window.hermesAPI
      ?.spsExportPage?.(SCRATCHPAD_PAGE_ID, text)
      .catch((error) => console.error("Failed to mirror scratchpad:", error));
  };

  const openPage = (id: string): void => {
    selectPage(id);
    setSurface("doc");
  };

  const unpin = (id: string): void => {
    const next = pinned.filter((candidate) => candidate !== id);
    setPinned(next);
    localStorage.setItem("sps-pinned-pages", JSON.stringify(next));
  };

  const createTask = async (): Promise<void> => {
    const rowId = uid("task");
    const task: Task = {
      id: taskRowPath(rowId),
      title: "New task",
      status: "todo",
      prio: "med",
      who: "you",
      due: "",
      est: "",
    };
    try {
      const saved = await window.hermesAPI.spsExportRow(
        TASKS_DB_FOLDER,
        rowId,
        rowToMarkdown({
          title: task.title,
          status: task.status,
          prio: task.prio,
          who: task.who,
          due: task.due,
          est: task.est,
        }),
      );
      if (!saved) {
        useStore.getState().flash("Could not create task", { tone: "warn" });
        return;
      }
      setOpenTask(task);
    } catch {
      useStore.getState().flash("Could not create task", { tone: "warn" });
    }
  };

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="scroll today-dashboard">
      <header className="today-header">
        <div>
          <p className="today-eyebrow">Today</p>
          <h1>{today}</h1>
        </div>
        <div className="today-actions" aria-label="Create">
          <button type="button" onClick={() => setTemplatesOpen({ parent: null })}>
            <Icon name="plus" size={14} /> New page
          </button>
          <button type="button" onClick={() => void createTask()}>
            <Icon name="checkbox" size={14} /> New task
          </button>
        </div>
      </header>

      <section className="today-section today-scratchpad">
        <div className="today-section-heading">
          <div>
            <h2>Scratchpad</h2>
            <p>Saved locally as you type.</p>
          </div>
        </div>
        <textarea
          aria-label="Today scratchpad"
          value={scratchText}
          onChange={(event) => updateScratchpad(event.target.value)}
          placeholder="Capture a thought…"
          rows={5}
        />
      </section>

      <div className="today-columns">
        <section className="today-section">
          <div className="today-section-heading">
            <h2>Pinned</h2>
          </div>
          {pinned.length === 0 ? (
            <p className="today-empty">No pinned pages.</p>
          ) : (
            <ul className="today-list">
              {pinned.map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => openPage(id)}>
                    <span aria-hidden="true">{meta[id]?.icon || "📄"}</span>
                    {meta[id]?.title || "Untitled"}
                  </button>
                  <button
                    type="button"
                    className="today-row-action"
                    onClick={() => unpin(id)}
                    aria-label={`Unpin ${meta[id]?.title || "page"}`}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="today-section">
          <div className="today-section-heading">
            <h2>Recent</h2>
          </div>
          {recents.length === 0 ? (
            <p className="today-empty">Pages you open will appear here.</p>
          ) : (
            <ul className="today-list">
              {recents.map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => openPage(id)}>
                    <span aria-hidden="true">{meta[id]?.icon || "📄"}</span>
                    {meta[id]?.title || "Untitled"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
