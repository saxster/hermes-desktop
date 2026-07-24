import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

// Isolate the filesystem: profile home → temp dir (mirrors the pattern in
// tests/skills-management.test.ts, realpathed for macOS /var → /private/var).
const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const os = require("os");
  const path = require("path");
  const fs = require("fs");
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "skill-packs-test-")),
  );
  return { TEST_HOME: path.join(base, "hermes") };
});

const listInstalledSkillsMock = vi.hoisted(() => vi.fn(() => [] as unknown[]));
vi.mock("./skills", () => ({
  listInstalledSkills: listInstalledSkillsMock,
}));

const recordSkillCapabilityMock = vi.hoisted(() => vi.fn());
vi.mock("./capability-risk-store", () => ({
  recordSkillCapability: recordSkillCapabilityMock,
}));

vi.mock("./utils", () => ({
  getActiveProfileNameSync: () => "default",
  profileHome: () => TEST_HOME,
  safeWriteFile: (filePath: string, content: string) => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  },
}));

import {
  importSkillPack,
  previewSkillPack,
  skillPackHash,
} from "./skill-packs";
import { validateSkillPack } from "../shared/skill-packs";

const PACK = {
  packId: "workspace-engine",
  title: "SPS Workspace Engine",
  version: 1,
  skills: [
    {
      name: "sps-workspace-layout",
      description: "Read or navigate the workspace.",
      body: "# Layout\n\nRules.",
    },
    {
      name: "sps-inbox-workflows",
      description: "Help process the SPS inbox.",
      body: "# Inbox\n\nWorkflows.",
      files: { "helper.py": "print('hi')\n" },
    },
  ],
};

const OUTCOME_KIT = {
  contractVersion: 1,
  kitId: "workspace-engine",
  title: "Workspace Engine Outcome Kit",
  version: 1,
  outcome: "Produce a reviewable workspace briefing.",
  inputs: [{ id: "topic", label: "Topic", required: true }],
  artifacts: [{ kind: "text", label: "Briefing", required: true }],
  criteria: [
    { id: "complete", text: "The briefing covers the requested topic." },
  ],
  dependencies: {
    skills: ["workspace-engine/sps-workspace-layout"],
    connectors: [],
    model: { capabilities: ["writing"], requireVerified: false },
  },
  recipe: {
    name: "Workspace briefing",
    kind: "custom",
    description: "Prepare a workspace briefing.",
    job: "Prepare a briefing.",
    inputs: "A topic.",
    output: "A briefing.",
    allowedActions: ["read_workspace", "draft_content"],
  },
  reviewPolicy: "review-first",
  risk: { mode: "INTERACTIVE", classes: ["READ"] },
  triggerTemplates: ["manual"],
  evalFixtures: [
    {
      id: "basic",
      input: "Project status",
      expectedCriteria: ["complete"],
      expectedArtifactKinds: ["text"],
    },
  ],
  provenance: { publisher: "Fathah Hermes" },
};

function writePack(payload: unknown, name = "pack.json"): string {
  mkdirSync(TEST_HOME, { recursive: true });
  const filePath = join(TEST_HOME, name);
  writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

beforeEach(() => {
  vi.clearAllMocks();
  listInstalledSkillsMock.mockReturnValue([]);
  // Import tests write into TEST_HOME/skills — start each case clean so a
  // previous case's writes don't trip the existsSync skip path.
  rmSync(join(TEST_HOME, "skills"), { recursive: true, force: true });
});

describe("skillPackHash", () => {
  it("is stable across key order and ignores envelope metadata", () => {
    const a = skillPackHash(PACK);
    const shuffled = {
      version: 1,
      title: "SPS Workspace Engine",
      packId: "workspace-engine",
      skills: PACK.skills,
    };
    expect(skillPackHash(shuffled as typeof PACK)).toBe(a);
  });
});

describe("previewSkillPack", () => {
  it("validates a good pack and reports the skill count", () => {
    const result = previewSkillPack(
      writePack({ schemaVersion: 1, pack: PACK }),
    );
    expect(result.ok).toBe(true);
    expect(result.canImport).toBe(true);
    expect(result.skillCount).toBe(2);
    expect(result.conflicts).toEqual([]);
    expect(result.packHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects unreadable files and unsupported schema versions", () => {
    expect(previewSkillPack(join(TEST_HOME, "missing.json")).ok).toBe(false);
    const bad = previewSkillPack(writePack({ schemaVersion: 99, pack: PACK }));
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain("schemaVersion");
  });

  it("blocks when every skill already installed, reports partial conflicts", () => {
    listInstalledSkillsMock.mockReturnValue([
      { name: "sps-workspace-layout", category: "workspace-engine" },
      { name: "sps-inbox-workflows", category: "workspace-engine" },
    ]);
    const blocked = previewSkillPack(writePack(PACK));
    expect(blocked.canImport).toBe(false);
    expect(blocked.errors[0]).toContain("already installed");

    listInstalledSkillsMock.mockReturnValue([
      { name: "sps-workspace-layout", category: "workspace-engine" },
    ]);
    const partial = previewSkillPack(writePack(PACK));
    expect(partial.canImport).toBe(true);
    expect(partial.conflicts).toEqual(["sps-workspace-layout"]);
  });
});

describe("importSkillPack", () => {
  it("writes validated skills into the profile skills directory", () => {
    const result = importSkillPack(writePack({ schemaVersion: 1, pack: PACK }));
    expect(result.ok).toBe(true);
    expect(result.imported).toEqual([
      "sps-workspace-layout",
      "sps-inbox-workflows",
    ]);
    const layoutPath = join(
      TEST_HOME,
      "skills",
      "workspace-engine",
      "sps-workspace-layout",
      "SKILL.md",
    );
    expect(existsSync(layoutPath)).toBe(true);
    expect(readFileSync(layoutPath, "utf-8")).toContain(
      'name: "sps-workspace-layout"',
    );
    expect(
      existsSync(
        join(
          TEST_HOME,
          "skills",
          "workspace-engine",
          "sps-inbox-workflows",
          "helper.py",
        ),
      ),
    ).toBe(true);
    expect(recordSkillCapabilityMock).toHaveBeenCalledTimes(2);
  });

  it("skips already-installed skills instead of overwriting", () => {
    listInstalledSkillsMock.mockReturnValue([
      { name: "sps-workspace-layout", category: "workspace-engine" },
    ]);
    const result = importSkillPack(writePack(PACK));
    expect(result.ok).toBe(true);
    expect(result.skipped).toEqual(["sps-workspace-layout"]);
    expect(result.imported).toEqual(["sps-inbox-workflows"]);
  });

  it("fails cleanly on an invalid pack", () => {
    const result = importSkillPack(writePack({ packId: "x" }));
    expect(result.ok).toBe(false);
    expect(result.imported).toEqual([]);
  });

  it("registers Outcome Kit content even when its skills are already installed", () => {
    listInstalledSkillsMock.mockReturnValue([
      { name: "sps-workspace-layout", category: "workspace-engine" },
      { name: "sps-inbox-workflows", category: "workspace-engine" },
    ]);
    const result = importSkillPack(
      writePack({ ...PACK, outcomeKit: OUTCOME_KIT }, "outcome-pack.json"),
    );
    expect(result.ok).toBe(true);
    expect(result.imported).toEqual([]);
    expect(result.outcomeKitRegistered).toBe(true);
    const stored = JSON.parse(
      readFileSync(join(TEST_HOME, "sps-agent", "outcome-kits.json"), "utf-8"),
    );
    expect(stored[0].kit.kitId).toBe("workspace-engine");
    expect(stored[0].recipeId).toBeUndefined();
  });
});

describe("the shipped workspace-engine pack", () => {
  it("validates and previews cleanly", () => {
    const packPath = join(
      process.cwd(),
      "skill-packs",
      "workspace-engine.json",
    );
    const raw = JSON.parse(readFileSync(packPath, "utf-8"));
    const validation = validateSkillPack(raw.pack ?? raw);
    expect(validation.errors).toEqual([]);
    const preview = previewSkillPack(packPath);
    expect(preview.canImport).toBe(true);
    expect(preview.skillCount).toBe(2);
  });
});
