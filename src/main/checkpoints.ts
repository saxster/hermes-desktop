import { existsSync } from "fs";
import { join } from "path";
import { HERMES_HOME, HERMES_PYTHON } from "./installer";
import { stripAnsi } from "./utils";
import { runHermesCli } from "./hermes-cli-runner";

async function runCheckpointsCommand(
  args: string[],
  profile: string | undefined,
  timeoutMs: number,
): Promise<{ success: boolean; output: string }> {
  const result = await runHermesCli(["checkpoints", ...args], {
    profile,
    timeoutMs,
  });
  return {
    success: result.success,
    output: stripAnsi(result.stdout + result.stderr),
  };
}

export async function getCheckpointsStatus(profile?: string): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return "Hermes is not installed.";
  }
  const result = await runCheckpointsCommand(["status"], profile, 15000);
  return result.output;
}

export async function pruneCheckpoints(
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return runCheckpointsCommand(["prune"], profile, 30000);
}

export async function clearCheckpoints(
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return runCheckpointsCommand(["clear"], profile, 30000);
}

function HERMES_SCRIPT_PATH(): string {
  return join(
    HERMES_HOME,
    "hermes-agent",
    process.platform === "win32" ? "venv/Scripts/hermes.exe" : "hermes",
  );
}
