import { applyTweaks } from "../lib/theme";
import {
  loadWorkspace,
  saveWorkspace,
  mirrorPage,
  mirrorAllPages,
} from "../lib/persistence";
import { getStorageMode } from "../lib/storageMode";
import {
  readVaultWorkspace,
  saveVaultPages,
  deleteVaultPages,
} from "../lib/vaultStore";
import { gcOrphanAssets } from "../lib/assets";
import type { Block, PageMeta, Workspace } from "../types";
import type { Store } from "./storeTypes";
import { saveSidebar } from "./slices/sidebar";
import { saveTweaks } from "./slices/tweaks";
import { saveUserTemplates } from "./slices/templates";
import { saveCockpit } from "./slices/cockpit";
import { useStore } from "./index";

type Unsubscribe = () => void;

function snapshotWorkspace(s: Store): Workspace {
  return {
    tree: s.tree,
    meta: s.meta,
    docs: s.docs,
    comments: s.comments,
    trash: s.trash,
    page: s.page,
  };
}

// MED-8: what the markdown mirror last saw, per page. Zustand updates are
// immutable, so reference inequality on docs[id]/meta[id] reliably means "this
// page changed since it was last mirrored" — the subscriber mirrors exactly
// those pages (background commits included: OKF import, wiki-ingest, land
// reports), not just the one that is open. Seeded by the hydrate-time
// mirrorAllPages pass so the first post-hydrate edit diffs correctly.
let mirroredDocs: Record<string, Block[]> = {};
let mirroredMeta: Record<string, PageMeta | undefined> = {};

function seedMirrored(s: Store): void {
  mirroredDocs = { ...s.docs };
  mirroredMeta = { ...s.meta };
}

function mirrorChangedPages(s: Store): void {
  for (const pageId of Object.keys(s.docs)) {
    const docChanged = s.docs[pageId] !== mirroredDocs[pageId];
    const metaChanged = s.meta[pageId] !== mirroredMeta[pageId];
    if (!docChanged && !metaChanged) continue;
    mirrorPage(pageId, s.meta[pageId] ?? {}, s.docs[pageId] ?? []);
    mirroredDocs[pageId] = s.docs[pageId];
    mirroredMeta[pageId] = s.meta[pageId];
  }
  // Pages gone from docs were permanently deleted (trash keeps its docs) —
  // drop their mirror files so search/backlinks stop resurrecting them.
  const removed = Object.keys(mirroredDocs).filter((id) => !(id in s.docs));
  if (removed.length) {
    deleteVaultPages(removed).catch((error: unknown) => {
      console.error("[SPS lifecycle] Failed to delete mirrored pages:", error);
      useStore.getState().flash("Some deleted pages remain in the vault", {
        tone: "warn",
      });
    });
    for (const id of removed) {
      delete mirroredDocs[id];
      delete mirroredMeta[id];
    }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleUsers = 0;
let stopSubscriptions: Unsubscribe | null = null;
let vaultSaveQueue: Promise<void> = Promise.resolve();
let workspacePersistenceBlocked = true;

function changedPageIds(s: Store): string[] {
  return Object.keys(s.docs).filter(
    (pageId) =>
      s.docs[pageId] !== mirroredDocs[pageId] ||
      s.meta[pageId] !== mirroredMeta[pageId],
  );
}

function persistVaultWorkspace(s: Store, ws: Workspace): void {
  const pageIds = changedPageIds(s);
  const removed = Object.keys(mirroredDocs).filter((id) => !(id in s.docs));
  vaultSaveQueue = vaultSaveQueue.then(async () => {
    const result = await saveVaultPages(ws, pageIds);
    useStore.getState().reportSaveResult(result);
    if (!result.ok) return;
    for (const pageId of pageIds) {
      mirroredDocs[pageId] = ws.docs[pageId];
      mirroredMeta[pageId] = ws.meta[pageId];
    }
    if (removed.length) {
      await deleteVaultPages(removed);
      for (const pageId of removed) {
        delete mirroredDocs[pageId];
        delete mirroredMeta[pageId];
      }
    }
  });
}

function persistCurrentWorkspace(): void {
  if (workspacePersistenceBlocked) return;
  const s = useStore.getState();
  const ws = snapshotWorkspace(s);
  if (getStorageMode() === "vault") {
    // Vault is authoritative (S6): write every changed page + the manifest.
    // The blob remains untouched as the rollback safety net.
    persistVaultWorkspace(s, ws);
    return;
  }
  saveWorkspace(ws)
    .then((res) => useStore.getState().reportSaveResult(res))
    .catch((error: unknown) => {
      console.error("[SPS lifecycle] Workspace save failed:", error);
      useStore.getState().flash("Workspace changes were not saved", {
        tone: "warn",
      });
    });
  mirrorChangedPages(s);
}

function subscribeToStore(): Unsubscribe {
  const unsubscribes = [
    useStore.subscribe(
      (s) => s.t,
      (t) => {
        applyTweaks(t);
        saveTweaks(t);
      },
    ),
    useStore.subscribe(
      (s) => [s.sectionsEnabled, s.sectionsOpen] as const,
      ([sectionsEnabled, sectionsOpen]) =>
        saveSidebar({ sectionsEnabled, sectionsOpen }),
    ),
    useStore.subscribe(
      (s) => s.userTemplates,
      (userTemplates) => saveUserTemplates(userTemplates),
    ),
    useStore.subscribe(
      (s) => s.cockpit,
      (cockpit) => saveCockpit(cockpit),
    ),
    useStore.subscribe(
      (s) => [s.tree, s.meta, s.docs, s.comments, s.trash, s.page] as const,
      () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          persistCurrentWorkspace();
        }, 350);
      },
      { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
    ),
  ];

  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      persistCurrentWorkspace();
    }
  };
}

/** Own SPS store side effects for the lifetime of one or more mounted hosts. */
export function startSpsStoreLifecycle(): Unsubscribe {
  lifecycleUsers += 1;
  stopSubscriptions ??= subscribeToStore();
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    lifecycleUsers -= 1;
    if (lifecycleUsers === 0) {
      stopSubscriptions?.();
      stopSubscriptions = null;
    }
  };
}

function applyWorkspace(ws: Workspace): void {
  useStore.setState({
    tree: ws.tree,
    meta: ws.meta,
    docs: ws.docs,
    comments: ws.comments ?? [],
    trash: ws.trash ?? [],
    page: ws.page in (ws.docs || {}) ? ws.page : "home",
  });
}

let hydrationPromise: Promise<void> | null = null;

async function loadAndApplyWorkspace(): Promise<void> {
  try {
    if (getStorageMode() === "vault") {
      const vault = await readVaultWorkspace();
      if (vault && vault.docs && vault.tree) {
        applyWorkspace(vault);
        seedMirrored(useStore.getState());
        gcOrphanAssets(vault.docs);
        workspacePersistenceBlocked = false;
        useStore.getState().setWorkspaceLoadIssue(null);
        return;
      }
      // Vault not populated yet — fall back to the blob so the user is not
      // stranded. Migration still happens only through the storage switch.
    }

    const result = await loadWorkspace();
    if (result.status !== "ok" && result.status !== "missing") {
      workspacePersistenceBlocked = true;
      useStore.getState().setWorkspaceLoadIssue({
        kind: result.status,
        error: result.error,
      });
      return;
    }
    if (result.status === "missing") {
      workspacePersistenceBlocked = false;
      useStore.getState().setWorkspaceLoadIssue(null);
      seedMirrored(useStore.getState());
      return;
    }
    applyWorkspace(result.workspace);
    // Materialize the markdown substrate for every page once on load (S2b), then
    // seed the diff mirror so later saves export only changed pages.
    mirrorAllPages(snapshotWorkspace(useStore.getState()));
    seedMirrored(useStore.getState());
    gcOrphanAssets(useStore.getState().docs);
    workspacePersistenceBlocked = false;
    useStore.getState().setWorkspaceLoadIssue(null);
  } catch (err) {
    workspacePersistenceBlocked = true;
    useStore.getState().setWorkspaceLoadIssue({
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Load the authoritative workspace once; concurrent callers share the load. */
export function hydrateWorkspace(): Promise<void> {
  if (!hydrationPromise) {
    hydrationPromise = loadAndApplyWorkspace().catch((error: unknown) => {
      hydrationPromise = null;
      throw error;
    });
  }
  return hydrationPromise;
}

/** Retry after the user repairs or restores the authoritative workspace. */
export function retryWorkspaceHydration(): Promise<void> {
  hydrationPromise = null;
  return hydrateWorkspace();
}
