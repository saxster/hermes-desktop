import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts", "roadmap-live-gate.mjs");

function exitCode(err: unknown): number {
  const value = err as { status?: number; code?: number };
  return value.status ?? value.code ?? 1;
}

function stdoutText(err: unknown): string {
  return (err as { stdout?: string }).stdout ?? "";
}

async function runAsync(
  home: string,
  extraArgs: string[] = [],
): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [SCRIPT, "--home", home, ...extraArgs],
    { encoding: "utf-8" },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

function writeReadyOwnerConfig(
  home: string,
  port: number,
  token: string,
): void {
  writeFileSync(join(home, "active_profile"), "work");
  writeFileSync(
    join(home, "desktop.json"),
    JSON.stringify({
      controlServerPort: port,
      controlServerToken: token,
      ownerNotificationPrefsByProfile: {
        work: {
          channels: { macos: false, telegram: true },
          targets: { telegramChatId: "12345" },
        },
      },
    }),
  );
  writeFileSync(
    join(home, "channel_directory.json"),
    JSON.stringify({ channels: [{ target: "telegram:12345" }] }),
  );
}

async function startControlServer(token: string): Promise<{
  port: number;
  close: () => Promise<void>;
  postCount: () => number;
}> {
  let postCount = 0;
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (req.method === "GET" && req.url === "/state") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ profile: "work", gatewayRunning: true }));
      return;
    }
    if (req.method === "POST" && req.url === "/sps/mobile-task") {
      postCount += 1;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: false }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind to a TCP port");
  }
  return {
    port: address.port,
    postCount: () => postCount,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("roadmap-live-gate script", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hermes-roadmap-live-gate-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("aggregates remaining blockers without sending or writing", () => {
    let status = 0;
    let stdout = "";

    try {
      execFileSync(process.execPath, [SCRIPT, "--home", home], {
        encoding: "utf-8",
      });
    } catch (err) {
      status = exitCode(err);
      stdout = stdoutText(err);
    }

    const result = JSON.parse(stdout) as Record<string, unknown>;

    expect(status).toBe(2);
    expect(result).toMatchObject({
      status: "blocked",
      mode: "dry-run",
      gates: {
        ownerChannelReadiness: { status: "blocked" },
        ownerChannelLive: {
          status: "blocked",
          reason: "telegram-not-ready",
        },
        mobileTask: {
          status: "blocked",
          reason: "missing-control-server-config",
        },
      },
    });
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        "owner-channel-readiness:missing-owner-notification-prefs",
        "owner-channel-live:telegram-not-ready",
        "mobile-task:missing-control-server-config",
      ]),
    );
  });

  it("passes the dry-run gate when Telegram and the control server are ready", async () => {
    const token = "control-token";
    const server = await startControlServer(token);
    writeReadyOwnerConfig(home, server.port, token);

    try {
      const result = await runAsync(home);

      expect(result).toMatchObject({
        status: "ready",
        mode: "dry-run",
        gates: {
          ownerChannelReadiness: {
            status: "ready",
            telegramLiveReady: true,
          },
          ownerChannelLive: { status: "dry-run" },
          mobileTask: { status: "dry-run" },
        },
      });
      expect(result.blockingReasons).toEqual([]);
      expect(server.postCount()).toBe(0);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain("12345");
    } finally {
      await server.close();
    }
  });

  it("keeps live send and write behind the existing explicit environment flags", async () => {
    const token = "control-token";
    const server = await startControlServer(token);
    writeReadyOwnerConfig(home, server.port, token);
    let status = 0;
    let stdout = "";

    try {
      await execFileAsync(process.execPath, [SCRIPT, "--home", home, "--live"]);
    } catch (err) {
      status = exitCode(err);
      stdout = stdoutText(err);
    } finally {
      await server.close();
    }

    const result = JSON.parse(stdout) as Record<string, unknown>;

    expect(status).toBe(2);
    expect(result).toMatchObject({
      status: "blocked",
      mode: "live",
      gates: {
        ownerChannelLive: {
          status: "blocked",
          reason: "missing-live-env",
        },
        mobileTask: {
          status: "blocked",
          reason: "missing-live-env",
        },
      },
    });
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining([
        "owner-channel-live:missing-live-env",
        "mobile-task:missing-live-env",
      ]),
    );
    expect(server.postCount()).toBe(0);
  });
});
