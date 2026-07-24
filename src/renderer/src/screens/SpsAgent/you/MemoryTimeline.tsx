import { useEffect, useState, useCallback } from "react";
import { Clock, Trash2, MessageSquare, Pencil } from "lucide-react";
import type {
  MemoryTimeline as Timeline,
  TimelineEntry,
} from "../../../../../shared/memoryTimeline";
import {
  getMemoryTimeline,
  removeMemoryEntry,
  updateMemoryEntry,
} from "../../../lib/api/memory";

/**
 * Agent-curated memory timeline (idea A4). Lists memory entries in file order
 * (≈ chronological) with the originating session's provenance (found via FTS),
 * a link to open that session, and a reject (remove) action. Edits/removes
 * reuse the existing memory IPC — no new storage format.
 */
export function MemoryTimeline({
  profile,
  onRefresh,
  onOpenSession,
}: {
  profile?: string;
  onRefresh: () => void;
  onOpenSession?: (sessionId: string) => void;
}): React.JSX.Element {
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getMemoryTimeline(profile)
      .then(setTimeline)
      .catch(() => setTimeline({ entries: [] }))
      .finally(() => setLoading(false));
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = useCallback(
    async (index: number) => {
      await removeMemoryEntry(index, profile);
      load();
      onRefresh();
    },
    [profile, load, onRefresh],
  );

  const removeEntry = useCallback(
    (index: number): void => {
      handleRemove(index).catch((error: unknown) => {
        console.error("[Memory Timeline] Failed to remove entry:", error);
      });
    },
    [handleRemove],
  );

  const editEntry = useCallback(
    async (index: number, content: string): Promise<boolean> => {
      const result = await updateMemoryEntry(index, content, profile);
      if (!result.success) return false;
      load();
      onRefresh();
      return true;
    },
    [load, onRefresh, profile],
  );

  if (loading) {
    return <div className="memory-timeline-empty">Loading…</div>;
  }

  const entries = timeline?.entries ?? [];
  if (entries.length === 0) {
    return (
      <div className="memory-timeline-empty">
        No memory entries yet. My Assistant writes here as it learns about you.
      </div>
    );
  }

  return (
    <div className="memory-timeline">
      {entries.map((entry) => (
        <TimelineRow
          key={entry.index}
          entry={entry}
          onRemove={() => removeEntry(entry.index)}
          onEdit={(content) => editEntry(entry.index, content)}
          onOpenSession={onOpenSession}
        />
      ))}
    </div>
  );
}

function TimelineRow({
  entry,
  onRemove,
  onEdit,
  onOpenSession,
}: {
  entry: TimelineEntry;
  onRemove: () => void;
  onEdit: (content: string) => Promise<boolean>;
  onOpenSession?: (sessionId: string) => void;
}): React.JSX.Element {
  const prov = entry.provenance;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveEdit(): Promise<void> {
    if (!draft.trim()) return;
    setSaving(true);
    setError("");
    try {
      const ok = await onEdit(draft.trim());
      if (ok) setEditing(false);
      else setError("Could not update this memory.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="memory-timeline-row">
      <div className="memory-timeline-rail">
        <Clock size={13} />
        <span className="memory-timeline-line" />
      </div>
      <div className="memory-timeline-card">
        {editing ? (
          <div className="memory-timeline-edit">
            <textarea
              aria-label="Edit memory"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
            />
            <div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={saving || !draft.trim()}
                onClick={() => void saveEdit()}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            {error && <span className="memory-error">{error}</span>}
          </div>
        ) : (
          <div className="memory-timeline-content">{entry.content}</div>
        )}
        <div className="memory-timeline-meta">
          {prov ? (
            <button
              type="button"
              className="memory-timeline-source"
              onClick={() => onOpenSession?.(prov.sessionId)}
              title="Open the session this was likely learned from"
            >
              <MessageSquare size={12} />
              {prov.title || `Session ${prov.sessionId.slice(-6)}`}
              <span className="memory-timeline-date">
                {new Date(prov.startedAt * 1000).toLocaleDateString()}
              </span>
            </button>
          ) : (
            <span className="memory-timeline-source memory-timeline-source--none">
              Origin unknown
            </span>
          )}
          <button
            type="button"
            className="memory-timeline-remove"
            onClick={() => setEditing(true)}
            title="Edit this memory"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="memory-timeline-remove"
            onClick={onRemove}
            title="Reject / remove this memory"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
