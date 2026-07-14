import { describe, it, expect, beforeEach, vi } from "vitest";

const mockWriteFileSync = vi.fn();
const mockExistsSync = vi.fn();
const mockExec = vi.fn((...args: unknown[]) => {
  const cb = args[1];
  if (typeof cb === "function") cb(null, "success", "");
});
const mockExecFile = vi.fn((...args: unknown[]) => {
  const cb = args[3];
  if (typeof cb === "function") cb(null, "success", "");
});
const mockUnlinkSync = vi.fn();
const mockHermesHome = vi.fn(() => "/tmp/hermes-test-home/.hermes");
const mockGetApiServerKey = vi.fn(() => "desk-auth-token");

const filesInMemory = new Map<string, string>();

function launchAgentWrite(): [string, string] {
  const call = mockWriteFileSync.mock.calls.find(([path]) =>
    String(path).endsWith("com.nousresearch.hermes-scheduler.plist"),
  );
  if (!call) throw new Error("LaunchAgent plist was not written");
  return [String(call[0]), String(call[1])];
}

// Phase 1.2 — the routine lock is now a JSON record at <HERMES_HOME>/locks/<id>.lock
// rather than a bare-PID file in /tmp. These two knobs let a test stand in a lock
// (live, dead, or stale) without knowing the exact resolved path.
let lockExists = false;
let lockContent = "{}";

vi.mock("fs", () => {
  const fns = {
    existsSync: (p: string) => {
      if (p.endsWith(".lock")) return lockExists;
      if (filesInMemory.has(p)) return true;
      return mockExistsSync(p);
    },
    mkdirSync: () => {},
    writeFileSync: (p: string, content: string, options?: unknown) => {
      if (p.endsWith(".lock")) {
        lockExists = true;
        lockContent = content;
      }
      filesInMemory.set(p, content);
      mockWriteFileSync(p, content, options);
    },
    unlinkSync: (p: string) => {
      if (p.endsWith(".lock")) lockExists = false;
      filesInMemory.delete(p);
      mockUnlinkSync(p);
    },
    chmodSync: () => {},
    createWriteStream: () => ({
      write: () => {},
      end: () => {},
    }),
    readFileSync: (p: string) => {
      if (p.endsWith(".lock")) return lockContent;
      return filesInMemory.get(p) ?? "{}";
    },
  };
  return { ...fns, default: fns };
});

vi.mock("child_process", () => {
  const mockSpawn = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: (event: string, callback: (...args: unknown[]) => void) => {
      if (event === "close") {
        setTimeout(() => callback(0), 10);
      }
    },
  };
  const fns = {
    exec: (...args: unknown[]) => {
      const cb = args[args.length - 1];
      mockExec(...args);
      if (typeof cb === "function") {
        (cb as (...args: unknown[]) => void)(null, "success", "");
      }
    },
    execFile: (...args: unknown[]) => {
      const cb = args[args.length - 1];
      mockExecFile(...args);
      if (typeof cb === "function") {
        (cb as (...args: unknown[]) => void)(null, "success", "");
      }
    },
    spawn: () => mockSpawn,
  };
  return { ...fns, default: fns };
});

vi.mock("os", () => {
  const fns = {
    homedir: () => "/tmp/hermes-test-home",
  };
  return { ...fns, default: fns };
});

vi.mock("electron", () => {
  return {
    app: {
      isReady: () => true,
    },
    desktopCapturer: {
      getSources: async () => [],
    },
  };
});

vi.mock("../src/main/installer/paths", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/installer/paths")>();
  return {
    ...actual,
    getHermesHome: () => mockHermesHome(),
  };
});

const mockReadDesktopConfig = vi.fn(() => ({}));
const mockWriteDesktopConfig = vi.fn();
vi.mock("../src/main/config", () => ({
  readDesktopConfig: () => mockReadDesktopConfig(),
  writeDesktopConfig: (c: unknown) => mockWriteDesktopConfig(c),
  getConnectionConfig: () => ({ mode: "local" }),
  getApiServerKey: () => mockGetApiServerKey(),
}));

vi.mock("../src/main/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/utils")>();
  return {
    ...actual,
    getActiveProfileNameSync: () => "test-profile",
    profileHome: (p: string) => `/tmp/hermes-test-home/.hermes/${p}`,
    safeWriteFile: (p: string, content: string) => {
      filesInMemory.set(p, content);
      mockWriteFileSync(p, content);
    },
  };
});

vi.mock("../src/main/learning-proposals", () => ({
  createLearningProposal: vi.fn(),
}));

vi.mock("../src/main/skills", () => ({
  listInstalledSkills: vi.fn(() => []),
  getSkillContent: vi.fn(() => ""),
}));

vi.mock("../src/main/cronjobs", () => ({
  listCronJobs: () => [],
}));

vi.mock("../src/main/self-healing", () => ({
  triggerSelfHealing: () => {},
}));

import {
  manageLaunchAgent,
  renderTaskProposalHelperScript,
} from "../src/main/control-server";
import { runJobHeadless } from "../src/main/scheduler";

describe("launchd Daemon & File-based Single Flight Locking", () => {
  beforeEach(() => {
    filesInMemory.clear();
    vi.clearAllMocks();
    lockExists = false;
    lockContent = "{}";
    mockHermesHome.mockReturnValue("/tmp/hermes-test-home/.hermes");
    mockExistsSync.mockImplementation((p: string) => {
      // Mock plist directory and standard paths exists
      if (p.includes("Library/LaunchAgents") || p.includes(".hermes")) {
        return true;
      }
      return false;
    });
  });

  it("should generate macOS LaunchAgent plist and trigger bootstrap", () => {
    // Only test if on darwin, otherwise skip or mock process.platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    manageLaunchAgent(true);

    expect(mockWriteFileSync).toHaveBeenCalled();
    const [plistPath, plistContent] = launchAgentWrite();

    expect(plistPath).toContain(
      "/tmp/hermes-test-home/Library/LaunchAgents/com.nousresearch.hermes-scheduler.plist",
    );
    expect(plistContent).toContain(
      "<string>com.nousresearch.hermes-scheduler</string>",
    );
    expect(plistContent).toContain("<key>StartInterval</key>");
    expect(plistContent).toContain(
      "<string>/tmp/hermes-test-home/.hermes/bin/hermes-cron.cjs</string>",
    );
    expect(plistContent).toContain("<key>HERMES_HOME</key>");
    expect(plistContent).toContain(
      "<string>/tmp/hermes-test-home/.hermes</string>",
    );
    expect(plistContent).toContain("<key>ELECTRON_RUN_AS_NODE</key>");
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockExecFile).toHaveBeenCalledWith(
      "launchctl",
      ["bootout", `gui/${process.getuid?.() ?? 0}`, plistPath],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      "launchctl",
      ["bootstrap", `gui/${process.getuid?.() ?? 0}`, plistPath],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("stores the resolved gateway key in a mode-0600 headless token file, not the plist", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    manageLaunchAgent(true);

    expect(
      filesInMemory.get("/tmp/hermes-test-home/.hermes/headless-gateway.token"),
    ).toBe("desk-auth-token\n");
    const [, plistContent] = launchAgentWrite();
    expect(plistContent).not.toContain("desk-auth-token");

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("always exports HERMES_HOME when launchd uses a standalone Node binary", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExistsSync.mockImplementation((p: string) => {
      if (p === "/opt/homebrew/bin/node") return true;
      return p.includes("Library/LaunchAgents") || p.includes(".hermes");
    });

    manageLaunchAgent(true);

    const [, plistContent] = launchAgentWrite();
    expect(plistContent).toContain("<string>/opt/homebrew/bin/node</string>");
    expect(plistContent).toContain("<key>HERMES_HOME</key>");
    expect(plistContent).toContain(
      "<string>/tmp/hermes-test-home/.hermes</string>",
    );
    expect(plistContent).not.toContain("<key>ELECTRON_RUN_AS_NODE</key>");

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("XML-escapes custom Hermes home paths in the LaunchAgent plist", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockHermesHome.mockReturnValue(`/tmp/Hermes & <custom> 'quoted' "home"`);

    manageLaunchAgent(true);

    const [, plistContent] = launchAgentWrite();
    const escapedHome =
      "/tmp/Hermes &amp; &lt;custom&gt; &apos;quoted&apos; &quot;home&quot;";
    expect(plistContent).toContain(`<string>${escapedHome}</string>`);
    expect(plistContent).toContain(
      `<string>${escapedHome}/bin/hermes-cron.cjs</string>`,
    );
    expect(plistContent).not.toContain("<custom>");

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("generated task helper writes one atomic review proposal without touching the vault", () => {
    const script = renderTaskProposalHelperScript();

    expect(script).toContain("task-proposals', 'inbox'");
    expect(script).toContain("source-message-id");
    expect(script).toContain("pending-approval");
    expect(script).toContain("fs.renameSync(temporary, target)");
    expect(script).not.toContain("vault/tasks");
  });

  it("should prevent duplicate runs when a live lock is held", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    // A lock owned by THIS process (definitely alive) with a fresh timestamp must
    // block — that is the single-flight guarantee.
    lockExists = true;
    lockContent = JSON.stringify({ pid: process.pid, startedAt: Date.now() });

    const success = await runJobHeadless(
      "job-123",
      "Test Task",
      "test-profile",
    );
    expect(success).toBe(false);
    // It must NOT overwrite the live lock.
    const wroteALock = mockWriteFileSync.mock.calls.some(([p]) =>
      String(p).endsWith("job-123.lock"),
    );
    expect(wroteALock).toBe(false);

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("should self-heal: steal a dead-owner lock and run the job", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    // A lock left by a process that no longer exists (crash) must be stolen rather
    // than wedging the job forever — the core 1.2 fix.
    lockExists = true;
    lockContent = JSON.stringify({ pid: 999999, startedAt: Date.now() });

    const success = await runJobHeadless(
      "job-456",
      "Test Task",
      "test-profile",
    );
    expect(success).toBe(true);
    // It re-takes the lock with a fresh JSON record.
    const wroteLock = mockWriteFileSync.mock.calls.find(([p]) =>
      String(p).endsWith("job-456.lock"),
    );
    expect(wroteLock).toBeDefined();
    expect(String(wroteLock?.[1])).toContain(`"pid":${process.pid}`);

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("should create a JSON lockfile on run and clean it up on completion", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });

    lockExists = false;

    const successPromise = runJobHeadless(
      "job-999",
      "Test Task",
      "test-profile",
    );

    // Writes a JSON record (pid + startedAt) to <id>.lock, not a bare PID.
    const lockWrite = mockWriteFileSync.mock.calls.find(([p]) =>
      String(p).endsWith("job-999.lock"),
    );
    expect(lockWrite).toBeDefined();
    expect(String(lockWrite?.[0])).toContain("locks");
    expect(String(lockWrite?.[1])).toContain(`"pid":${process.pid}`);

    const success = await successPromise;
    expect(success).toBe(true);

    // Cleans up its lock on completion.
    const unlinked = mockUnlinkSync.mock.calls.some(([p]) =>
      String(p).endsWith("job-999.lock"),
    );
    expect(unlinked).toBe(true);

    Object.defineProperty(process, "platform", { value: originalPlatform });
  });
});
