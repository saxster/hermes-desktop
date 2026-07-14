import { describe, expect, it, vi } from "vitest";
import type { CronRunnerRuntime } from "./cron-runner";
import { runHeadlessCron } from "./cron-runner";

function runtimeFixture(
  files: Record<string, string> = {},
  overrides: Partial<CronRunnerRuntime> = {},
): CronRunnerRuntime {
  const stored = new Map(Object.entries(files));
  return {
    env: {},
    platform: "darwin",
    homedir: () => "/Users/tester",
    now: () => new Date(2026, 6, 6, 8, 0, 0).getTime(),
    existsSync: (file) => stored.has(file),
    readFileSync: (file) => {
      const value = stored.get(file);
      if (value === undefined) throw new Error(`ENOENT: ${file}`);
      return value;
    },
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    writeFileSync: (file, value) => {
      stored.set(file, value);
    },
    renameSync: (from, to) => {
      const value = stored.get(from);
      if (value === undefined) throw new Error(`ENOENT: ${from}`);
      stored.set(to, value);
      stored.delete(from);
    },
    spawnSync: vi.fn(() => ({ status: 0, error: undefined })),
    spawn: vi.fn(() => ({
      once: vi.fn(),
      unref: vi.fn(),
    })),
    ...overrides,
  };
}

describe("headless cron runner", () => {
  it("uses HERMES_HOME, active_profile, and the canonical cron tick CLI", () => {
    const readFileSync = vi.fn((file: string) => {
      if (file === "/srv/hermes/active_profile") return "work\n";
      throw new Error(`ENOENT: ${file}`);
    });
    const spawnSync = vi.fn<CronRunnerRuntime["spawnSync"]>(() => ({
      status: 0,
      error: undefined,
    }));
    const runtime = runtimeFixture(
      {},
      {
        env: { HERMES_HOME: "/srv/hermes" },
        existsSync: (file) => file === "/srv/hermes/active_profile",
        readFileSync,
        spawnSync,
      },
    );

    const result = runHeadlessCron(runtime);

    expect(result).toMatchObject({ exitCode: 0, profile: "work" });
    expect(spawnSync).toHaveBeenCalledWith(
      "/srv/hermes/hermes-agent/venv/bin/python",
      ["/srv/hermes/hermes-agent/hermes", "-p", "work", "cron", "tick"],
      expect.objectContaining({
        cwd: "/srv/hermes/hermes-agent",
        shell: false,
        timeout: expect.any(Number),
      }),
    );
    const timeout = spawnSync.mock.calls[0]?.[2]?.timeout;
    expect(timeout).toBe(720_000);
    expect(timeout).toBeGreaterThan(600_000);
    expect(readFileSync.mock.calls.flat().join(" ")).not.toContain("jobs.json");
    expect(readFileSync.mock.calls.flat().join(" ")).not.toContain(
      ".tick.lock",
    );
  });

  it("uses ~/.hermes and omits the profile flag for the default profile", () => {
    const spawnSync = vi.fn(() => ({ status: 0, error: undefined }));
    const runtime = runtimeFixture({}, { spawnSync });

    const result = runHeadlessCron(runtime);

    expect(result.profile).toBe("default");
    expect(spawnSync).toHaveBeenCalledWith(
      "/Users/tester/.hermes/hermes-agent/venv/bin/python",
      ["/Users/tester/.hermes/hermes-agent/hermes", "cron", "tick"],
      expect.objectContaining({ shell: false }),
    );
  });

  it("skips every closed-app action when the authenticated Desktop state probe succeeds", () => {
    const home = "/Users/tester/.hermes";
    const spawnSync = vi.fn(() => ({ status: 0, error: undefined }));
    const spawn = vi.fn();
    const runtime = runtimeFixture(
      {
        [`${home}/desktop.json`]: JSON.stringify({
          controlServerPort: 8645,
          gatewaySupervisor: {
            enabled: true,
            mode: "local",
            profile: "default",
            port: 8642,
          },
        }),
        [`${home}/control-server.token`]: "secret-token\n",
        [`${home}/sps-agent/app-launcher.json`]: JSON.stringify({
          targets: [],
          schedules: [],
        }),
      },
      { spawnSync, spawn },
    );

    const result = runHeadlessCron(runtime);

    expect(result).toMatchObject({
      exitCode: 0,
      skippedForDesktop: true,
    });
    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(spawnSync).toHaveBeenCalledWith(
      "/usr/bin/curl",
      expect.arrayContaining([
        "Authorization: Bearer secret-token",
        "http://127.0.0.1:8645/state",
      ]),
      expect.objectContaining({ shell: false, timeout: expect.any(Number) }),
    );
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports a failed canonical tick as a nonzero executable result", () => {
    const runtime = runtimeFixture(
      {},
      {
        spawnSync: vi.fn(() => ({
          status: 2,
          error: undefined,
          stderr: "bad tick",
        })),
      },
    );

    const result = runHeadlessCron(runtime);

    expect(result).toMatchObject({ exitCode: 1, cronStatus: 2 });
  });

  it("restarts a closed-app gateway with the canonical Hermes script", () => {
    const home = "/Users/tester/.hermes";
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({ status: 0, error: undefined })
      .mockReturnValueOnce({ status: 22, error: undefined });
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ once: vi.fn(), unref }));
    const runtime = runtimeFixture(
      {
        [`${home}/active_profile`]: "work",
        [`${home}/headless-gateway.token`]: "desk-auth-token\n",
        [`${home}/desktop.json`]: JSON.stringify({
          gatewaySupervisor: {
            enabled: true,
            mode: "local",
            profile: "work",
            port: 8643,
          },
        }),
      },
      { spawnSync, spawn },
    );

    const result = runHeadlessCron(runtime);

    expect(result.exitCode).toBe(0);
    expect(spawn).toHaveBeenCalledWith(
      `${home}/hermes-agent/venv/bin/python`,
      [`${home}/hermes-agent/hermes`, "-p", "work", "gateway", "run"],
      expect.objectContaining({
        cwd: `${home}/hermes-agent`,
        detached: true,
        env: expect.objectContaining({ API_SERVER_KEY: "desk-auth-token" }),
        shell: false,
        stdio: "ignore",
      }),
    );
    expect(unref).toHaveBeenCalledOnce();
  });

  it("runs due closed-app macOS launch schedules without a shell", () => {
    const home = "/Users/tester/.hermes";
    const registryPath = `${home}/sps-agent/app-launcher.json`;
    const writes: Array<[string, string]> = [];
    const spawnSync = vi.fn(() => ({ status: 0, error: undefined }));
    const runtime = runtimeFixture(
      {
        [registryPath]: JSON.stringify({
          targets: [
            {
              id: "target-1",
              label: "Calendar",
              enabled: true,
              locator: {
                kind: "macos-app",
                appPath: "/Applications/Calendar.app",
              },
            },
          ],
          schedules: [
            {
              id: "schedule-1",
              label: "Morning calendar",
              targetIds: ["target-1"],
              cadence: "daily",
              hour: 8,
              enabled: true,
              runWhenClosed: true,
              lastRunAt: new Date(2026, 6, 5, 8, 0, 0).getTime(),
            },
          ],
        }),
      },
      {
        spawnSync,
        writeFileSync: (file, value) => {
          writes.push([file, value]);
        },
        renameSync: vi.fn(),
      },
    );

    const result = runHeadlessCron(runtime);

    expect(result.exitCode).toBe(0);
    expect(spawnSync).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["/Applications/Calendar.app"],
      expect.objectContaining({ shell: false }),
    );
    expect(
      writes.some(([, value]) => value.includes('"lastStatus": "ok"')),
    ).toBe(true);
  });

  it("does not rerun a closed-app schedule in the same cadence period", () => {
    const home = "/Users/tester/.hermes";
    const spawnSync = vi.fn(() => ({ status: 0, error: undefined }));
    const runtime = runtimeFixture(
      {
        [`${home}/sps-agent/app-launcher.json`]: JSON.stringify({
          targets: [
            {
              id: "target-1",
              label: "Calendar",
              enabled: true,
              locator: {
                kind: "macos-app",
                appPath: "/Applications/Calendar.app",
              },
            },
          ],
          schedules: [
            {
              id: "schedule-1",
              label: "Morning calendar",
              targetIds: ["target-1"],
              cadence: "daily",
              hour: 8,
              enabled: true,
              runWhenClosed: true,
              lastRunAt: new Date(2026, 6, 6, 7, 0, 0).getTime(),
            },
          ],
        }),
      },
      { spawnSync },
    );

    runHeadlessCron(runtime);

    expect(spawnSync).toHaveBeenCalledTimes(1);
    expect(spawnSync).not.toHaveBeenCalledWith(
      "/usr/bin/open",
      expect.anything(),
      expect.anything(),
    );
  });
});
