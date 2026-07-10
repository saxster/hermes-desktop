import {
  execFile,
  execFileSync,
  type ChildProcess,
  type ExecFileOptions,
  type ExecFileSyncOptions,
} from "child_process";
import { homedir } from "os";
import {
  getEnhancedPath,
  HERMES_HOME,
  HERMES_PYTHON,
  HERMES_REPO,
  hermesCliArgs,
} from "./installer/paths";
import { HIDDEN_SUBPROCESS_OPTIONS } from "./process-options";

export interface HermesCliResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface HermesCliRunOptions {
  profile?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
}

type HermesExecFile = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: (
    error: Error | null,
    stdout: string | Buffer,
    stderr: string | Buffer,
  ) => void,
) => ChildProcess;

interface HermesCliRuntime {
  execFile: HermesExecFile;
  execFileSync: typeof execFileSync;
}

const defaultRuntime: HermesCliRuntime = {
  execFile: execFile as HermesExecFile,
  execFileSync,
};

let runtime = defaultRuntime;

export function hermesCliCommandArgs(
  commandArgs: string[],
  profile?: string,
): string[] {
  const args = hermesCliArgs();
  if (profile && profile !== "default") args.push("-p", profile);
  args.push(...commandArgs);
  return args;
}

export function runHermesCli(
  commandArgs: string[],
  options: HermesCliRunOptions = {},
): Promise<HermesCliResult> {
  const execOptions: ExecFileOptions = {
    cwd: options.cwd ?? HERMES_REPO,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
      HERMES_HOME,
      ...options.env,
    },
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer,
    ...HIDDEN_SUBPROCESS_OPTIONS,
  };

  return new Promise((resolve) => {
    const child = runtime.execFile(
      HERMES_PYTHON,
      hermesCliCommandArgs(commandArgs, options.profile),
      execOptions,
      (error, stdout, stderr) => {
        const stdoutText = String(stdout || "");
        const stderrText = String(stderr || "");
        resolve({
          success: !error,
          stdout: stdoutText,
          stderr: stderrText,
          error: error
            ? stderrText.trim() || stdoutText.trim() || error.message
            : undefined,
        });
      },
    );
    child.stdin?.end();
  });
}

export function runHermesCliSync(
  commandArgs: string[],
  options: HermesCliRunOptions = {},
): string {
  const execOptions: ExecFileSyncOptions = {
    cwd: options.cwd ?? HERMES_REPO,
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      HOME: homedir(),
      HERMES_HOME,
      ...options.env,
    },
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
    ...HIDDEN_SUBPROCESS_OPTIONS,
  };
  const output = runtime.execFileSync(
    HERMES_PYTHON,
    hermesCliCommandArgs(commandArgs, options.profile),
    execOptions,
  );
  return String(output || "");
}

export function __setHermesCliRuntimeForTests(
  next?: Partial<HermesCliRuntime>,
): void {
  runtime = next ? { ...defaultRuntime, ...next } : defaultRuntime;
}
