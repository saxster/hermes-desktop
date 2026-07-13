import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useStore } from "../store";
import { uid } from "../lib/ids";
import { rowFromMarkdown, rowToMarkdown } from "../editor/rowMarkdown";
import { TASKS_DB_FOLDER, taskRowPath } from "../tasks/taskStorage";
import type { Task } from "../types";

const SCRATCHPAD_PAGE_ID = "dashboard_scratchpad";
const SCRATCHPAD_DB_FOLDER = "_dashboard";
const SCRATCHPAD_ROW_ID = "scratchpad";
const RECENT_LIMIT = 5;

export function Dashboard(): React.JSX.Element {
  const meta = useStore((state) => state.meta);
  const scratchpadDoc = useStore((state) => state.docs[SCRATCHPAD_PAGE_ID]);
  const selectPage = useStore((state) => state.selectPage);
  const setSurface = useStore((state) => state.setSurface);
  const setTemplatesOpen = useStore((state) => state.setTemplatesOpen);
  const setOpenTask = useStore((state) => state.setOpenTask);
  const flash = useStore((state) => state.flash);
  const [scratchText, setScratchText] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const scratchWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const scratchSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScratchText = useRef<string | null>(null);
  const lastQueuedScratchText = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await window.hermesAPI.spsReadRow?.(
          SCRATCHPAD_DB_FOLDER,
          SCRATCHPAD_ROW_ID,
        );
        const legacyText = scratchpadDoc?.[0]?.text || "";
        const text = saved ? rowFromMarkdown(saved).body : legacyText;
        if (!cancelled) setScratchText(text);

        // Migrate the old hidden workspace page only after the canonical row is
        // durable. Folder rows are file-authoritative in both storage modes and
        // do not participate in workspace manifest parity.
        if (scratchpadDoc) {
          const durable =
            saved !== null && saved !== undefined
              ? true
              : await window.hermesAPI.spsExportRow(
                  SCRATCHPAD_DB_FOLDER,
                  SCRATCHPAD_ROW_ID,
                  rowToMarkdown(
                    { title: "Dashboard scratchpad", system: true },
                    legacyText,
                  ),
                );
          if (durable) {
            useStore.setState((state) => {
              const docs = { ...state.docs };
              const nextMeta = { ...state.meta };
              delete docs[SCRATCHPAD_PAGE_ID];
              delete nextMeta[SCRATCHPAD_PAGE_ID];
              return { docs, meta: nextMeta };
            });
            await window.hermesAPI.spsDeletePage?.(SCRATCHPAD_PAGE_ID);
          }
        }
      } catch (error) {
        console.error("Failed to load dashboard scratchpad:", error);
        if (!cancelled) setScratchText(scratchpadDoc?.[0]?.text || "");
      }
    })().catch((error: unknown) => {
      console.error("Failed to initialize dashboard scratchpad:", error);
    });
    return () => {
      cancelled = true;
    };
  }, [scratchpadDoc]);

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

  const queueScratchpadWrite = useCallback(
    (text: string): void => {
      if (lastQueuedScratchText.current === text) return;
      lastQueuedScratchText.current = text;
      const markdown = rowToMarkdown(
        { title: "Dashboard scratchpad", system: true },
        text,
      );
      scratchWriteQueue.current = scratchWriteQueue.current
        .then(async () => {
          const saved = await window.hermesAPI.spsExportRow(
            SCRATCHPAD_DB_FOLDER,
            SCRATCHPAD_ROW_ID,
            markdown,
          );
          if (!saved) throw new Error("Scratchpad row write failed");
        })
        .catch((error) => {
          if (lastQueuedScratchText.current === text) {
            lastQueuedScratchText.current = null;
          }
          console.error("Failed to save dashboard scratchpad:", error);
          flash("Scratchpad changes were not saved. Try again.", {
            tone: "warn",
            ms: 8000,
          });
        });
    },
    [flash],
  );

  const flushScratchpad = useCallback((): void => {
    if (scratchSaveTimer.current) {
      clearTimeout(scratchSaveTimer.current);
      scratchSaveTimer.current = null;
    }
    const pending = pendingScratchText.current;
    pendingScratchText.current = null;
    if (pending !== null) queueScratchpadWrite(pending);
  }, [queueScratchpadWrite]);

  useEffect(
    () => () => {
      flushScratchpad();
    },
    [flushScratchpad],
  );

  const updateScratchpad = (text: string): void => {
    setScratchText(text);
    pendingScratchText.current = text;
    if (scratchSaveTimer.current) clearTimeout(scratchSaveTimer.current);
    scratchSaveTimer.current = setTimeout(flushScratchpad, 300);
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
          <button
            type="button"
            onClick={() => setTemplatesOpen({ parent: null })}
          >
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
          onBlur={flushScratchpad}
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
