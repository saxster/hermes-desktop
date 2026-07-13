import { promises as fs } from "fs";
import { join } from "path";
import {
  WorkspaceWriteQueue,
  selectBackupsToPrune,
  OVERSIZE_ADVISORY_BYTES,
  type WorkspaceQueueIO,
} from "../sps-write-queue";
import {
  SPS_WORKSPACE_VERSION,
  type Workspace,
  type SpsSaveResult,
  type SpsWorkspaceLoadResult,
} from "../../shared/sps-types";
import {
  profileHome,
  getActiveProfileNameSync,
  safeWriteFileAsync,
} from "../utils";

function workspacePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    "workspace.json",
  );
}

function workspaceDir(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "sps-agent");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseWorkspaceDocument(raw: string): SpsWorkspaceLoadResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.tree) ||
      !isRecord(parsed.meta) ||
      !isRecord(parsed.docs) ||
      !Array.isArray(parsed.comments) ||
      !Array.isArray(parsed.trash) ||
      typeof parsed.page !== "string"
    ) {
      return { status: "corrupt", error: "Workspace schema is invalid." };
    }
    if (
      parsed.version !== undefined &&
      parsed.version !== SPS_WORKSPACE_VERSION
    ) {
      return {
        status: "corrupt",
        error: `Unsupported workspace version: ${String(parsed.version)}.`,
      };
    }
    return {
      status: "ok",
      workspace: {
        ...(parsed as unknown as Workspace),
        version: SPS_WORKSPACE_VERSION,
      },
    };
  } catch (err) {
    return {
      status: "corrupt",
      error: err instanceof Error ? err.message : "Workspace JSON is invalid.",
    };
  }
}

export async function spsLoad(
  profile?: string,
): Promise<SpsWorkspaceLoadResult> {
  try {
    return parseWorkspaceDocument(
      await fs.readFile(workspacePath(profile), "utf-8"),
    );
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { status: "missing" };
    return {
      status: "error",
      error:
        err instanceof Error ? err.message : "Workspace could not be read.",
    };
  }
}

// One serialized write queue per profile guards workspace.json against the
// whole-blob last-write-wins hazard.
const writeQueues = new Map<string, WorkspaceWriteQueue>();

function listBackups(profile?: string): Promise<string[]> {
  const dir = workspaceDir(profile);
  return fs
    .readdir(dir)
    .then((names) =>
      names
        .filter((name) => name.startsWith("workspace.json.bak-"))
        .map((name) => join(dir, name)),
    )
    .catch(() => []);
}

function makeQueueIo(profile?: string): WorkspaceQueueIO {
  const p = workspacePath(profile);
  return {
    async read() {
      const result = await spsLoad(profile);
      if (result.status === "missing") return null;
      if (result.status === "ok") return result.workspace;
      throw new Error(result.error);
    },
    async write(blob) {
      const json = JSON.stringify({ ...blob, version: SPS_WORKSPACE_VERSION });
      await safeWriteFileAsync(p, json);
      return Buffer.byteLength(json);
    },
    async backup() {
      await spsBackupWorkspace(profile);
    },
    async prune(keep) {
      const existing = await listBackups(profile);
      const stale = selectBackupsToPrune(existing, keep);
      await Promise.all(stale.map((path) => fs.unlink(path).catch(() => {})));
    },
    now() {
      return Date.now();
    },
  };
}

function queueFor(profile?: string): WorkspaceWriteQueue {
  const key = profile || getActiveProfileNameSync();
  let queue = writeQueues.get(key);
  if (!queue) {
    queue = new WorkspaceWriteQueue(makeQueueIo(profile));
    writeQueues.set(key, queue);
  }
  return queue;
}

export async function spsSave(
  ws: unknown,
  profile?: string,
  baseRev?: number,
): Promise<SpsSaveResult> {
  let parsed: SpsWorkspaceLoadResult;
  try {
    parsed = parseWorkspaceDocument(JSON.stringify(ws));
  } catch (err) {
    parsed = {
      status: "corrupt",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (parsed.status !== "ok") {
    return {
      ok: false,
      error:
        parsed.status === "missing"
          ? "Workspace payload is missing."
          : parsed.error,
      rev: 0,
      merged: false,
    };
  }
  try {
    const outcome = await queueFor(profile).enqueue(parsed.workspace, baseRev);
    const oversize =
      typeof outcome.bytes === "number" &&
      outcome.bytes > OVERSIZE_ADVISORY_BYTES;
    return { ...outcome, oversize };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      rev: baseRev ?? 0,
      merged: false,
    };
  }
}

/** Drop a profile's in-memory write queue (its cached revision) — used after a
 *  snapshot restore so a late autosave can't clobber the restored blob. */
export function resetWorkspaceWriteQueue(profile?: string): void {
  writeQueues.delete(profile || getActiveProfileNameSync());
}

export async function spsBackupWorkspace(
  profile?: string,
): Promise<string | null> {
  try {
    const p = workspacePath(profile);
    const backup = `${p}.bak-${Date.now()}`;
    await fs.copyFile(p, backup);
    return backup;
  } catch {
    return null;
  }
}
