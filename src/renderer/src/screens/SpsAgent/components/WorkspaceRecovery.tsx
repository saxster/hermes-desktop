import { useEffect, useState } from "react";
import type { WorkspaceBackupInfo } from "../types";
import { retryWorkspaceHydration } from "../store/lifecycle";
import { useStore } from "../store";

interface WorkspaceRecoveryProps {
  onWorkspaceReady: () => void;
}

export function WorkspaceRecovery({
  onWorkspaceReady,
}: WorkspaceRecoveryProps) {
  const issue = useStore((state) => state.workspaceLoadIssue);
  const [backups, setBackups] = useState<WorkspaceBackupInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!issue) return;
    void window.hermesAPI
      .spsListBackups()
      .then(setBackups)
      .catch(() => setBackups([]));
  }, [issue]);

  if (!issue) return null;

  async function retry(): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      await retryWorkspaceHydration();
      if (!useStore.getState().workspaceLoadIssue) onWorkspaceReady();
    } finally {
      setBusy(false);
    }
  }

  async function preserveSource(): Promise<void> {
    setBusy(true);
    try {
      const path = await window.hermesAPI.spsBackupWorkspace();
      setMessage(
        path
          ? `Damaged source preserved at ${path}`
          : "The damaged source could not be preserved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function restoreLatest(): Promise<void> {
    const latest = backups[0];
    if (!latest) return;
    if (!window.confirm("Restore the latest workspace backup?")) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await window.hermesAPI.spsRestoreBackup(latest.id);
      if (!result.ok) {
        setMessage(result.error ?? "Backup restore failed.");
        return;
      }
      window.location.reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="workspace-recovery" role="alertdialog" aria-modal="true">
      <div className="workspace-recovery-card">
        <h1>Workspace recovery required</h1>
        <p>
          SPS stopped before saving because the workspace file is damaged or
          unreadable. Your current file has not been replaced.
        </p>
        <pre>{issue.error}</pre>
        <div className="workspace-recovery-actions">
          <button
            className="btn btn-primary"
            disabled={busy || !backups[0]}
            onClick={() => void restoreLatest()}
          >
            Restore latest backup
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void preserveSource()}
          >
            Preserve damaged source
          </button>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void retry()}
          >
            Retry load
          </button>
        </div>
        {!backups.length && <p>No workspace snapshots are available.</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </div>
  );
}
