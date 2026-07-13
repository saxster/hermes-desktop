import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSpy, localState } = vi.hoisted(() => ({
  localState: { profileHome: "C:/hermes" },
  execFileSpy: vi.fn(
    (
      _file: string,
      _args: string[],
      _options: Record<string, unknown>,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "ok", "");
      return { stdin: { end: vi.fn() } };
    },
  ),
}));

vi.mock("child_process", () => ({
  execFile: execFileSpy,
  default: { execFile: execFileSpy },
}));

vi.mock("../src/main/utils", () => ({
  profileHome: () => localState.profileHome,
}));

vi.mock("../src/main/hermes", () => ({
  isRemoteMode: () => false,
  getApiUrl: () => "http://127.0.0.1:8642",
  getRemoteAuthHeader: () => ({}),
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "C:/hermes",
  HERMES_PYTHON: "C:/hermes/hermes-agent/venv/Scripts/pythonw.exe",
  hermesCliArgs: (args: string[] = []) => ["-m", "hermes_cli.main", ...args],
}));

vi.mock("../src/main/installer/paths", () => ({
  HERMES_HOME: "C:/hermes",
  HERMES_REPO: "C:/hermes/hermes-agent",
  HERMES_PYTHON: "C:/hermes/hermes-agent/venv/Scripts/pythonw.exe",
  getEnhancedPath: () => process.env.PATH || "",
  hermesCliArgs: (args: string[] = []) => ["-m", "hermes_cli.main", ...args],
}));

describe("createCronJob", () => {
  let testHome: string | undefined;

  beforeEach(() => {
    execFileSpy.mockClear();
    localState.profileHome = "C:/hermes";
  });

  afterEach(() => {
    if (testHome) rmSync(testHome, { recursive: true, force: true });
    testHome = undefined;
  });

  it("passes the prompt as the cron create positional argument before flags", async () => {
    const { createCronJob } = await import("../src/main/cronjobs");

    await createCronJob(
      "7 17 * * *",
      "Create a daily brief with local news, weather, and quotes.",
      "Daily brief",
      "local",
    );

    expect(execFileSpy).toHaveBeenCalledTimes(1);
    expect(execFileSpy.mock.calls[0][1]).toEqual([
      "-m",
      "hermes_cli.main",
      "cron",
      "create",
      "7 17 * * *",
      "Create a daily brief with local news, weather, and quotes.",
      "--name",
      "Daily brief",
      "--deliver",
      "local",
    ]);
    expect(execFileSpy.mock.calls[0][1]).not.toContain("--");
  });

  it.each([
    {
      deliver: "local, telegram,local, email ",
      expected: ["local", "telegram", "email"],
    },
    {
      deliver: ["local", " telegram ", "local", "email"],
      expected: ["local", "telegram", "email"],
    },
  ])("normalizes $deliver delivery targets", async ({ deliver, expected }) => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-cronjobs-"));
    localState.profileHome = testHome;
    const cronDir = join(testHome, "cron");
    mkdirSync(cronDir);
    writeFileSync(
      join(cronDir, "jobs.json"),
      JSON.stringify({ jobs: [{ id: "job-1", deliver }] }),
    );
    const { listCronJobs } = await import("../src/main/cronjobs");

    const jobs = await listCronJobs();

    expect(jobs[0]?.deliver).toEqual(expected);
  });
});
