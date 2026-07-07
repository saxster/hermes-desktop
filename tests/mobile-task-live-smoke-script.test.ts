import { execFile, execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts", "mobile-task-live-smoke.mjs");

async function runAsync(
  home: string,
  extraArgs: string[] = [],
): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [SCRIPT, "--home", home, ...extraArgs],
    {
      encoding: "utf-8",
    },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

function exitCode(err: unknown): number {
  const value = err as { status?: number; code?: number };
  return value.status ?? value.code ?? 1;
}

function stdoutText(err: unknown): string {
  return (err as { stdout?: string }).stdout ?? "";
}

function writeDesktopConfig(home: string, port: number, token: string): void {
  writeFileSync(join(home, "active_profile"), "work");
  writeFileSync(
    join(home, "desktop.json"),
    JSON.stringify({
      controlServerPort: port,
      controlServerToken: token,
      ownerNotificationPrefsByProfile: {
        work: {
          targets: { telegramChatId: "12345" },
        },
      },
    }),
  );
}

function writeTaskRow(home: string, rowId: string): string {
  const dir = join(home, "profiles", "work", "sps-agent", "vault", "tasks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${rowId}.md`);
  writeFileSync(
    path,
    [
      "---",
      'title: "Check Friday guard roster"',
      'status: "inbox"',
      'route: "human"',
      'source: "telegram/mobile"',
      'captureChannel: "telegram"',
      "reviewRequired: true",
      'telegramChatId: "12345"',
      "---",
      "",
    ].join("\n"),
  );
  return path;
}

async function startControlServer(
  home: string,
  token: string,
  options: { writeRow?: boolean } = {},
): Promise<{
  port: number;
  close: () => Promise<void>;
  postCount: () => number;
  lastPostBody: () => string;
}> {
  let postCount = 0;
  let lastPostBody = "";
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${token}`) {
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
      req.setEncoding("utf-8");
      req.on("data", (chunk) => {
        lastPostBody += chunk;
      });
      req.on("end", () => {
        const rowId = "mobile-task-test";
        if (options.writeRow) writeTaskRow(home, rowId);
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            success: true,
            rowId,
            title: "Check Friday guard roster",
          }),
        );
      });
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
    lastPostBody: () => lastPostBody,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe("mobile-task-live-smoke script", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hermes-mobile-task-live-smoke-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("fails closed without control server discovery data", () => {
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

    expect(status).toBe(2);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "blocked",
      reason: "missing-control-server-config",
      hasPort: false,
      hasToken: false,
    });
  });

  it("dry-runs against a reachable control server without writing", async () => {
    const token = "control-token";
    const server = await startControlServer(home, token);
    writeDesktopConfig(home, server.port, token);

    try {
      const result = await runAsync(home, [
        "--text",
        "add this as a task: Check Friday",
      ]);

      expect(result).toMatchObject({
        status: "dry-run",
        profile: "work",
        controlPort: server.port,
        controlServerProfile: "work",
        gatewayRunning: true,
      });
      expect(server.postCount()).toBe(0);
      expect(JSON.stringify(result)).not.toContain(token);
      expect(JSON.stringify(result)).not.toContain("12345");
    } finally {
      await server.close();
    }
  });

  it("requires the live environment flag before writing", async () => {
    const token = "control-token";
    const server = await startControlServer(home, token);
    writeDesktopConfig(home, server.port, token);
    let status = 0;
    let stdout = "";

    try {
      await execFileAsync(process.execPath, [
        SCRIPT,
        "--home",
        home,
        "--write",
      ]);
    } catch (err) {
      status = exitCode(err);
      stdout = stdoutText(err);
    } finally {
      await server.close();
    }

    expect(status).toBe(2);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "blocked",
      reason: "missing-live-env",
      requiredEnv: "HERMES_MOBILE_TASK_LIVE=1",
    });
    expect(server.postCount()).toBe(0);
  });

  it("writes and verifies one review-first mobile task when live-enabled", async () => {
    const token = "control-token";
    const server = await startControlServer(home, token, { writeRow: true });
    writeDesktopConfig(home, server.port, token);

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          SCRIPT,
          "--home",
          home,
          "--text",
          "add this as a task: Check Friday guard roster",
          "--external-message-id",
          "msg-1",
          "--write",
        ],
        {
          encoding: "utf-8",
          env: { ...process.env, HERMES_MOBILE_TASK_LIVE: "1" },
        },
      );
      const result = JSON.parse(stdout) as Record<string, unknown>;
      const payload = JSON.parse(server.lastPostBody()) as Record<
        string,
        unknown
      >;
      const taskPath = String(result.taskPath);

      expect(result).toMatchObject({
        status: "written",
        rowId: "mobile-task-test",
        verified: {
          status: "inbox",
          route: "human",
          source: "telegram/mobile",
          captureChannel: "telegram",
          reviewRequired: true,
          hasContext: false,
          hasTelegramChatId: true,
        },
      });
      expect(payload).toMatchObject({
        text: "add this as a task: Check Friday guard roster",
        channel: "telegram",
        chatId: "12345",
        externalMessageId: "msg-1",
      });
      expect(stdout).not.toContain(token);
      expect(stdout).not.toContain("12345");
      expect(readFileSync(taskPath, "utf-8")).toContain(
        'source: "telegram/mobile"',
      );
    } finally {
      await server.close();
    }
  });
});
