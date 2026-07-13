import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { stripAnsi } from "../utils";
import { runHermesCli } from "../hermes-cli-runner";
import { HERMES_PYTHON, HERMES_SCRIPT } from "./paths";

export function validateImportArchivePath(
  archivePath: unknown,
): { success: true; path: string } | { success: false; error: string } {
  if (typeof archivePath !== "string" || archivePath.trim() === "") {
    return { success: false, error: "Import archive path is required." };
  }

  const path = resolve(archivePath);
  if (!existsSync(path)) {
    return { success: false, error: "Import archive does not exist." };
  }

  try {
    if (!statSync(path).isFile()) {
      return { success: false, error: "Import archive must be a file." };
    }
  } catch {
    return { success: false, error: "Import archive is not readable." };
  }

  return { success: true, path };
}

export async function runHermesBackup(
  profile?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return { success: false, error: "Hermes is not installed." };
  }
  const result = await runHermesCli(["backup"], {
    profile,
    env: { TERM: "dumb" },
    timeoutMs: 120000,
  });
  if (!result.success) {
    return {
      success: false,
      error: stripAnsi(result.error || "Backup failed.").slice(0, 500),
    };
  }
  const output = stripAnsi(result.stdout);
  const pathMatch = output.match(
    /(?:Backup saved|Written|Created).*?(\S+\.(?:tar\.gz|zip|tgz))/i,
  );
  return {
    success: true,
    path: pathMatch?.[1] || output.trim().split("\n").pop()?.trim(),
  };
}

export async function runHermesImport(
  archivePath: string,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  const archive = validateImportArchivePath(archivePath);
  if (!archive.success) {
    return { success: false, error: archive.error };
  }

  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return { success: false, error: "Hermes is not installed." };
  }
  const result = await runHermesCli(["import", archive.path], {
    profile,
    env: { TERM: "dumb" },
    timeoutMs: 120000,
  });
  if (!result.success) {
    return {
      success: false,
      error: stripAnsi(result.error || "Import failed.").slice(0, 500),
    };
  }
  return { success: true };
}
