import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  return {
    TEST_HOME: fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "cap-review-test-")),
    ),
  };
});

vi.mock("../src/main/utils", () => ({
  profileHome: () => TEST_HOME,
  getActiveProfileNameSync: () => "default",
  profilePaths: () => ({
    home: TEST_HOME,
    envFile: `${TEST_HOME}/.env`,
    configFile: `${TEST_HOME}/config.yaml`,
  }),
  escapeRegex: (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
}));

import {
  admitMcpCapability,
  readCapabilityRiskRegistry,
} from "../src/main/capability-risk-store";
import { listMcpServerEntries } from "../src/main/installer/mcp";
import { reviewCapabilityRisk } from "../src/main/capability-risk";

function writeConfig(enabled: boolean): void {
  writeFileSync(
    join(TEST_HOME, "config.yaml"),
    [
      "mcp_servers:",
      "  desktop:",
      '    command: "/opt/homebrew/bin/node"',
      "    args:",
      '      - "/Applications/Hermes Agent.app/desktop-mcp.cjs"',
      `    enabled: ${enabled}`,
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  mkdirSync(TEST_HOME, { recursive: true });
  writeConfig(false);
});

afterEach(() => {
  rmSync(TEST_HOME, { recursive: true, force: true });
});

describe("reviewCapabilityRisk", () => {
  it("enables the MCP server in config once the owner reviews it", () => {
    // Record the server the way the app does, which leaves it needing review.
    const [snapshot] = listMcpServerEntries();
    admitMcpCapability(snapshot.name, { ...snapshot.entry, enabled: true });
    const before = readCapabilityRiskRegistry();
    expect(
      before.reports.find((r) => r.id === "mcp:desktop")?.reviewState,
    ).not.toBe("reviewed");
    expect(readFileSync(join(TEST_HOME, "config.yaml"), "utf-8")).toContain(
      "enabled: false",
    );

    reviewCapabilityRisk("mcp:desktop");

    // The capability gate reads the review off disk, so a review that is saved
    // only after the enable attempt leaves config.yaml shut behind a UI that
    // reported success. This is the regression that kept the vault-write door
    // closed for the engine.
    expect(readFileSync(join(TEST_HOME, "config.yaml"), "utf-8")).toContain(
      "enabled: true",
    );
    const after = readCapabilityRiskRegistry();
    const desktop = after.reports.find((r) => r.id === "mcp:desktop");
    expect(desktop?.reviewState).toBe("reviewed");
    expect(desktop?.enabled).toBe(true);
    expect(desktop?.lastReviewedAt).toBeGreaterThan(0);
  });

  it("throws when the server cannot be enabled instead of reporting success", () => {
    const [snapshot] = listMcpServerEntries();
    admitMcpCapability(snapshot.name, { ...snapshot.entry, enabled: true });
    // A review for a server that is no longer in config.yaml must not look
    // like it worked.
    writeFileSync(join(TEST_HOME, "config.yaml"), "mcp_servers:\n");

    expect(() => reviewCapabilityRisk("mcp:desktop")).toThrow(/desktop/);
    // The review itself is still recorded, so it is not lost to the failure.
    expect(
      readCapabilityRiskRegistry().reports.find((r) => r.id === "mcp:desktop")
        ?.reviewState,
    ).toBe("reviewed");
  });
});
