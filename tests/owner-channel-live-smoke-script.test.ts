import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT = join(process.cwd(), "scripts", "owner-channel-live-smoke.mjs");

function run(home: string, extraArgs: string[] = []): Record<string, unknown> {
  const output = execFileSync(
    process.execPath,
    [SCRIPT, "--home", home, ...extraArgs],
    {
      encoding: "utf-8",
    },
  );
  return JSON.parse(output) as Record<string, unknown>;
}

function writeReadyTelegramConfig(home: string): void {
  writeFileSync(join(home, "active_profile"), "work");
  writeFileSync(
    join(home, "desktop.json"),
    JSON.stringify({
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

describe("owner-channel-live-smoke script", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hermes-owner-live-smoke-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("fails closed when Telegram readiness is blocked", () => {
    let status = 0;
    let stdout = "";
    try {
      execFileSync(process.execPath, [SCRIPT, "--home", home], {
        encoding: "utf-8",
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
      stdout = (err as { stdout?: string }).stdout ?? "";
    }

    expect(status).toBe(2);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "blocked",
      reason: "telegram-not-ready",
    });
  });

  it("dry-runs a ready Telegram config without sending", () => {
    writeReadyTelegramConfig(home);

    const result = run(home, ["--message", "Smoke test"]);

    expect(result).toMatchObject({
      status: "dry-run",
      profile: "work",
      telegramLiveReady: true,
      messageLength: "Smoke test".length,
    });
    expect(JSON.stringify(result)).not.toContain("12345");
  });

  it("requires the live environment flag before sending", () => {
    writeReadyTelegramConfig(home);
    let status = 0;
    let stdout = "";

    try {
      execFileSync(process.execPath, [
        SCRIPT,
        "--home",
        home,
        "--url",
        "http://127.0.0.1:9",
        "--send",
      ]);
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
      stdout = (err as { stdout?: string }).stdout ?? "";
    }

    expect(status).toBe(2);
    expect(JSON.parse(stdout)).toMatchObject({
      status: "blocked",
      reason: "missing-live-env",
      requiredEnv: "HERMES_OWNER_CHANNEL_LIVE=1",
    });
  });

  it("sends one redacted gateway request when explicitly live-enabled", async () => {
    writeReadyTelegramConfig(home);
    let requestAuth = "";
    let requestBody = "";
    const server = http.createServer((req, res) => {
      requestAuth = req.headers.authorization ?? "";
      req.setEncoding("utf-8");
      req.on("data", (chunk) => {
        requestBody += chunk;
      });
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "Telegram smoke sent" } }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind to a TCP port");
    }

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          SCRIPT,
          "--home",
          home,
          "--url",
          `http://127.0.0.1:${address.port}`,
          "--api-key",
          "secret-key",
          "--message",
          "Smoke test",
          "--send",
        ],
        {
          encoding: "utf-8",
          env: { ...process.env, HERMES_OWNER_CHANNEL_LIVE: "1" },
        },
      );

      const result = JSON.parse(stdout) as Record<string, unknown>;
      const body = JSON.parse(requestBody) as {
        messages: { content: string }[];
      };

      expect(result).toMatchObject({
        status: "sent",
        profile: "work",
        hasApiKey: true,
        telegramLiveReady: true,
      });
      expect(stdout).not.toContain("12345");
      expect(stdout).not.toContain("secret-key");
      expect(requestAuth).toBe("Bearer secret-key");
      expect(body.messages[0].content).toContain("chat id 12345");
      expect(body.messages[0].content).toContain("Message: Smoke test");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
