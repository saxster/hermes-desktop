import { existsSync } from "fs";
import { join } from "path";
import { HERMES_HOME, HERMES_PYTHON } from "./installer";
import { stripAnsi } from "./utils";
import { runHermesCli } from "./hermes-cli-runner";

async function runPairingCommand(
  args: string[],
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  const result = await runHermesCli(["pairing", ...args], {
    profile,
    timeoutMs: 15000,
  });
  return {
    success: result.success,
    output: stripAnsi(result.stdout + result.stderr),
  };
}

export async function listPairings(profile?: string): Promise<string> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return "Hermes is not installed.";
  }
  const result = await runPairingCommand(["list"], profile);
  return result.output;
}

export async function approvePairing(
  code: string,
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!code) return { success: false, output: "Code is required" };
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return runPairingCommand(["approve", code], profile);
}

export async function revokePairing(
  userId: string,
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!userId) return { success: false, output: "User ID is required" };
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return runPairingCommand(["revoke", userId], profile);
}

export async function clearPendingPairings(
  profile?: string,
): Promise<{ success: boolean; output: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT_PATH())) {
    return { success: false, output: "Hermes is not installed." };
  }
  return runPairingCommand(["clear-pending"], profile);
}

function HERMES_SCRIPT_PATH(): string {
  return join(
    HERMES_HOME,
    "hermes-agent",
    process.platform === "win32" ? "venv/Scripts/hermes.exe" : "hermes",
  );
}
