import { beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync } from "fs";

const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  return {
    TEST_HOME: fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "autonomy-mode-test-")),
    ),
  };
});

vi.mock("../src/main/installer", () => ({ HERMES_HOME: TEST_HOME }));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "default",
  localDateKey: () => "2026-07-24",
  safeWriteFile: (path: string, content: string) => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require("fs");
    const pathModule = require("path");
    fs.mkdirSync(pathModule.dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
  },
}));

import {
  getAutoApprove,
  getAutonomyMode,
  setAutoApprove,
  setAutonomyMode,
} from "../src/main/config/desktop-store";

beforeEach(() => {
  rmSync(`${TEST_HOME}/desktop.json`, { force: true });
});

describe("per-profile autonomy mode", () => {
  it("defaults to Interactive and persists all three explicit modes", () => {
    expect(getAutonomyMode("work")).toBe("INTERACTIVE");
    setAutonomyMode("READ_ONLY", "work");
    expect(getAutonomyMode("work")).toBe("READ_ONLY");
    expect(getAutoApprove("work")).toBe(false);
    setAutonomyMode("SCOPED_AUTOMATION", "work");
    expect(getAutonomyMode("work")).toBe("SCOPED_AUTOMATION");
    expect(getAutoApprove("work")).toBe(true);
  });

  it("keeps the legacy boolean API compatible without creating broad authority", () => {
    setAutoApprove(true, "legacy");
    expect(getAutonomyMode("legacy")).toBe("SCOPED_AUTOMATION");
    setAutoApprove(false, "legacy");
    expect(getAutonomyMode("legacy")).toBe("INTERACTIVE");
  });

  it("rejects unknown modes at the privileged boundary", () => {
    expect(() => setAutonomyMode("YOLO" as never, "work")).toThrow(
      "Unsupported autonomy mode",
    );
  });
});
