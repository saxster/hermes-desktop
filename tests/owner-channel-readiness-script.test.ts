import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "owner-channel-readiness.mjs");

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

describe("owner-channel-readiness script", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "hermes-owner-channel-ready-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("reports missing owner prefs as a blocked, redacted state", () => {
    writeFileSync(join(home, "active_profile"), "work");
    writeFileSync(join(home, "desktop.json"), JSON.stringify({}));

    const result = run(home);

    expect(result).toMatchObject({
      status: "blocked",
      profile: "work",
      desktopConfigExists: true,
      ownerPrefsEntryExists: false,
      telegramLiveReady: false,
    });
    expect(result.blockingReasons).toEqual(
      expect.arrayContaining(["missing-owner-notification-prefs"]),
    );
    expect(JSON.stringify(result)).not.toContain("12345");
  });

  it("reports Telegram ready only when owner prefs and gateway channel are both present", () => {
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

    const result = run(home, ["--profile", "work"]);

    expect(result).toMatchObject({
      status: "ready",
      profile: "work",
      telegramLiveReady: true,
      channelDirectoryTelegramTargets: 1,
    });
    expect(result.readyChannels).toEqual(["telegram"]);
    expect(JSON.stringify(result)).not.toContain("12345");
  });

  it("exits non-zero with --require-ready when readiness is blocked", () => {
    let status = 0;
    try {
      execFileSync(process.execPath, [
        SCRIPT,
        "--home",
        home,
        "--require-ready",
      ]);
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
    }

    expect(status).toBe(2);
  });
});
