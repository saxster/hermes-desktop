import { BrowserWindow, dialog } from "electron";
import { basename, dirname, join } from "path";
import { safeHandle } from "../safe-handle";
import {
  createAssistantRecipe,
  deleteAssistantRecipe,
  listAssistantRecipeRuns,
  listAssistantRecipes,
  runAssistantRecipe,
  saveAssistantRecipeRun,
  updateAssistantRecipe,
} from "../../assistant-recipes";
import {
  exportLocalExpertPack,
  getLocalExpertPack,
  importLocalExpertPack,
  installLocalExpertPack,
  listLocalExpertPacks,
  previewLocalExpertPack,
  uninstallLocalExpertPack,
} from "../../local-experts";
import {
  enableLocalExpertChecks,
  runLocalExpertChecks,
} from "../../local-experts/macos-checks";
import { importSkillPack, previewSkillPack } from "../../skill-packs";
import {
  activateOutcomeKit,
  enableOutcomeKitSchedule,
  listOutcomeKits,
  runOutcomeKit,
} from "../../outcome-kits";
import type {
  AssistantRecipePatch,
  CreateAssistantRecipeInput,
} from "../../../shared/assistant-recipes";
import { requireLocalWorkspace } from "../connection-guards";
import { assertIpcString, normalizeIpcProfile } from "../validate";
import {
  assertGrantedDirectoryPath,
  assertGrantedFilePath,
  grantDirectoryPath,
  grantFilePath,
} from "../../file-access-grants";

function normalizeExportTarget(targetPath: unknown): string {
  const safeTargetPath = assertIpcString(
    targetPath,
    "local expert export path",
  );
  const fileName = basename(safeTargetPath);
  if (!fileName || fileName === "." || fileName === "..") {
    throw new Error("local expert export filename must not be empty.");
  }
  const grantedDir = assertGrantedDirectoryPath(dirname(safeTargetPath));
  return join(grantedDir, fileName);
}

function packExportFilename(packId: string): string {
  const safeName = packId.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${safeName || "local-expert-pack"}.json`;
}

export function registerSpsLearningIpc(): void {
  safeHandle("sps-list-assistant-recipes", (_event, profile?: string) =>
    listAssistantRecipes(profile),
  );
  safeHandle(
    "sps-create-assistant-recipe",
    (_event, input: CreateAssistantRecipeInput, profile?: string) =>
      createAssistantRecipe(input, profile),
  );
  safeHandle(
    "sps-update-assistant-recipe",
    (_event, id: string, patch: AssistantRecipePatch, profile?: string) =>
      updateAssistantRecipe(id, patch, profile),
  );
  safeHandle(
    "sps-delete-assistant-recipe",
    (_event, id: string, profile?: string) =>
      deleteAssistantRecipe(id, profile),
  );
  safeHandle(
    "sps-run-assistant-recipe",
    (_event, id: string, userInput?: string, profile?: string) =>
      runAssistantRecipe(id, userInput, profile),
  );
  safeHandle(
    "sps-list-assistant-recipe-runs",
    (_event, recipeId?: string, profile?: string) =>
      listAssistantRecipeRuns(recipeId, profile),
  );
  safeHandle(
    "sps-save-assistant-recipe-run",
    (_event, runId: string, profile?: string) =>
      saveAssistantRecipeRun(runId, profile),
  );
  safeHandle("sps-list-local-experts", (_event, profile?: string) =>
    listLocalExpertPacks(profile),
  );
  safeHandle(
    "sps-get-local-expert",
    (_event, packId: string, profile?: string) =>
      getLocalExpertPack(packId, profile),
  );
  safeHandle(
    "sps-install-local-expert",
    (_event, packId: string, profile?: string) =>
      installLocalExpertPack(packId, profile),
  );
  safeHandle(
    "sps-uninstall-local-expert",
    (_event, packId: string, profile?: string) =>
      uninstallLocalExpertPack(packId, profile),
  );
  safeHandle(
    "sps-preview-local-expert-pack",
    (_event, filePath: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      return previewLocalExpertPack(
        assertGrantedFilePath(
          assertIpcString(filePath, "local expert pack path"),
        ),
        normalizeIpcProfile(profile),
      );
    },
  );
  safeHandle(
    "sps-import-local-expert-pack",
    (_event, filePath: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      return importLocalExpertPack(
        assertGrantedFilePath(
          assertIpcString(filePath, "local expert pack path"),
        ),
        normalizeIpcProfile(profile),
      );
    },
  );
  safeHandle(
    "sps-export-local-expert-pack",
    (_event, packId: unknown, targetPath: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      return exportLocalExpertPack(
        assertIpcString(packId, "pack id"),
        normalizeExportTarget(targetPath),
        normalizeIpcProfile(profile),
      );
    },
  );
  safeHandle("sps-pick-local-expert-pack", async (event) => {
    requireLocalWorkspace();
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "Local Expert Pack", extensions: ["json"] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return grantFilePath(result.filePaths[0]);
  });
  safeHandle(
    "sps-pick-local-expert-pack-export-path",
    async (event, packId: unknown) => {
      requireLocalWorkspace();
      const safePackId = assertIpcString(packId, "pack id");
      const win = BrowserWindow.fromWebContents(event.sender);
      const opts: Electron.SaveDialogOptions = {
        defaultPath: packExportFilename(safePackId),
        filters: [{ name: "Local Expert Pack", extensions: ["json"] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return null;
      const safeTargetPath = assertIpcString(
        result.filePath,
        "local expert export path",
      );
      const fileName = basename(safeTargetPath);
      if (!fileName || fileName === "." || fileName === "..") {
        throw new Error("local expert export filename must not be empty.");
      }
      const grantedDir = grantDirectoryPath(dirname(safeTargetPath));
      return join(grantedDir, fileName);
    },
  );
  safeHandle(
    "sps-enable-local-expert-checks",
    (_event, packId: string, profile?: string) =>
      enableLocalExpertChecks(packId, profile),
  );
  safeHandle(
    "sps-run-local-expert-checks",
    (_event, packId: string, profile?: string) =>
      runLocalExpertChecks(packId, profile),
  );
  // Skill packs: preview-then-import of original SKILL.md bundles into the
  // profile's skills/ directory. Picker grants the file path; preview/import
  // re-assert the grant, mirroring the local-expert pack flow.
  safeHandle("sps-pick-skill-pack", async (event) => {
    requireLocalWorkspace();
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts: Electron.OpenDialogOptions = {
      properties: ["openFile"],
      filters: [{ name: "Skill Pack", extensions: ["json"] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return grantFilePath(result.filePaths[0]);
  });
  safeHandle(
    "sps-preview-skill-pack",
    (_event, filePath: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      return previewSkillPack(
        assertGrantedFilePath(assertIpcString(filePath, "skill pack path")),
        normalizeIpcProfile(profile),
      );
    },
  );
  safeHandle(
    "sps-import-skill-pack",
    (_event, filePath: unknown, profile?: unknown) => {
      requireLocalWorkspace();
      return importSkillPack(
        assertGrantedFilePath(assertIpcString(filePath, "skill pack path")),
        normalizeIpcProfile(profile),
      );
    },
  );
  safeHandle("sps-list-outcome-kits", (_event, profile?: string) =>
    listOutcomeKits(profile),
  );
  safeHandle(
    "sps-activate-outcome-kit",
    (_event, kitId: string, profile?: string) =>
      activateOutcomeKit(kitId, profile),
  );
  safeHandle(
    "sps-enable-outcome-kit-schedule",
    (_event, kitId: string, profile?: string) =>
      enableOutcomeKitSchedule(kitId, profile),
  );
  safeHandle(
    "sps-run-outcome-kit",
    (
      _event,
      kitId: string,
      inputs: Record<string, string>,
      profile?: string,
      trigger?: "manual" | "scheduled" | "cron" | "proposal" | "external",
    ) => runOutcomeKit(kitId, inputs, profile, trigger),
  );
}
