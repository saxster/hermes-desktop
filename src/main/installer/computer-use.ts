import { spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { stripAnsi } from "../utils";
import { HIDDEN_SUBPROCESS_OPTIONS } from "../process-options";
import { runHermesCli } from "../hermes-cli-runner";
import {
  HERMES_PYTHON,
  HERMES_SCRIPT,
  HERMES_REPO,
  HERMES_HOME,
  hermesCliArgs,
  getEnhancedPath,
} from "./paths";
import type { InstallProgress } from "../../shared/install";

export async function getComputerUseStatus(
  profile?: string,
): Promise<{ installed: boolean; output: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    return { installed: false, output: "Hermes is not installed." };
  }
  const result = await runHermesCli(["computer-use", "status"], {
    profile,
    timeoutMs: 10000,
  });
  const output = result.stdout.trim();
  const installed =
    output.includes("installed") && !output.includes("not installed");
  return { installed, output: stripAnsi(output) };
}

export async function installComputerUseDriver(
  onProgress: (progress: InstallProgress) => void,
  profile?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!existsSync(HERMES_PYTHON) || !existsSync(HERMES_SCRIPT)) {
    throw new Error("Hermes is not installed.");
  }
  let log = "";
  function emit(text: string): void {
    log += text;
    onProgress({
      step: 1,
      totalSteps: 1,
      title: "Installing CUA Driver",
      detail: text.trim().slice(0, 120),
      log,
    });
  }

  emit("Starting computer-use driver installation...\n");

  return new Promise((resolve) => {
    const args = hermesCliArgs(["computer-use", "install"]);
    if (profile && profile !== "default") {
      args.splice(process.platform === "win32" ? 2 : 1, 0, "-p", profile);
    }
    const proc = spawn(HERMES_PYTHON, args, {
      cwd: HERMES_REPO,
      env: {
        ...process.env,
        PATH: getEnhancedPath(),
        HOME: homedir(),
        HERMES_HOME,
        TERM: "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
      ...HIDDEN_SUBPROCESS_OPTIONS,
    });

    proc.stdout?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.stderr?.on("data", (data: Buffer) => {
      emit(stripAnsi(data.toString()));
    });

    proc.on("close", (code) => {
      if (code === 0) {
        emit("\nInstallation complete!\n");
        resolve({ success: true });
      } else {
        resolve({ success: false, error: `Failed with exit code ${code}` });
      }
    });

    proc.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}
