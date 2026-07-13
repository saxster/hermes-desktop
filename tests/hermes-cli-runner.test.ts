import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChildProcess,
  ExecFileOptions,
  ExecFileSyncOptions,
} from "child_process";
import {
  __setHermesCliRuntimeForTests,
  hermesCliCommandArgs,
  runHermesCli,
  runHermesCliSync,
} from "../src/main/hermes-cli-runner";

afterEach(() => {
  __setHermesCliRuntimeForTests();
});

describe("Hermes CLI runner", () => {
  it("places the profile before the command and closes stdin", async () => {
    const end = vi.fn();
    const execFile = vi.fn(
      (
        _file: string,
        _args: readonly string[],
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(null, "ok\n", "");
        return { stdin: { end } } as unknown as ChildProcess;
      },
    );
    __setHermesCliRuntimeForTests({ execFile });

    const result = await runHermesCli(["mcp", "list"], {
      profile: "work",
      timeoutMs: 1234,
    });

    const args = execFile.mock.calls[0][1] as readonly string[];
    const options = execFile.mock.calls[0][2] as ExecFileOptions;
    expect(args.slice(-4)).toEqual(["-p", "work", "mcp", "list"]);
    expect(options).toMatchObject({ timeout: 1234, windowsHide: true });
    expect(options.env).toMatchObject({ HERMES_HOME: expect.any(String) });
    expect(end).toHaveBeenCalledOnce();
    expect(result).toEqual({
      success: true,
      stdout: "ok\n",
      stderr: "",
      error: undefined,
    });
  });

  it("prefers stderr for a failed command's actionable error", async () => {
    const execFile = vi.fn(
      (
        _file: string,
        _args: readonly string[],
        _options: ExecFileOptions,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(new Error("exit 1"), "partial", "bad input\n");
        return { stdin: { end: vi.fn() } } as unknown as ChildProcess;
      },
    );
    __setHermesCliRuntimeForTests({ execFile });

    await expect(runHermesCli(["doctor"])).resolves.toMatchObject({
      success: false,
      stdout: "partial",
      stderr: "bad input\n",
      error: "bad input",
    });
  });

  it("omits the profile flag for the default profile", () => {
    expect(hermesCliCommandArgs(["doctor"], "default").slice(-1)).toEqual([
      "doctor",
    ]);
  });

  it("uses the same command and environment contract for sync commands", () => {
    const execFileSync = vi.fn(
      (
        _file: string,
        _args: readonly string[],
        _options: ExecFileSyncOptions,
      ) => Buffer.from("Hermes 1.0\n"),
    );
    __setHermesCliRuntimeForTests({
      execFileSync:
        execFileSync as unknown as typeof import("child_process").execFileSync,
    });

    expect(runHermesCliSync(["--version"])).toBe("Hermes 1.0\n");
    const call = execFileSync.mock.calls[0];
    expect(call).toBeDefined();
    expect(call![1].slice(-1)).toEqual(["--version"]);
    expect(call![2]).toMatchObject({
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });
});
