import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, rmSync } from "fs";
import { join } from "path";
import type { OutcomeKitDefinition } from "../src/shared/outcome-kits";

const { TEST_HOME } = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  return {
    TEST_HOME: fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "outcome-kits-test-")),
    ),
  };
});

const mocks = vi.hoisted(() => ({
  listAssistantRecipes: vi.fn(() => [] as unknown[]),
  createAssistantRecipe: vi.fn(),
  updateAssistantRecipe: vi.fn(),
  runAssistantRecipe: vi.fn(),
  listMcpServers: vi.fn(),
  listInstalledSkills: vi.fn(),
  getModelConfig: vi.fn(),
  validateChatReadiness: vi.fn(),
}));

vi.mock("../src/main/assistant-recipes", () => ({
  listAssistantRecipes: mocks.listAssistantRecipes,
  createAssistantRecipe: mocks.createAssistantRecipe,
  updateAssistantRecipe: mocks.updateAssistantRecipe,
  runAssistantRecipe: mocks.runAssistantRecipe,
}));
vi.mock("../src/main/mcp-servers", () => ({
  listMcpServers: mocks.listMcpServers,
}));
vi.mock("../src/main/skills", () => ({
  listInstalledSkills: mocks.listInstalledSkills,
}));
vi.mock("../src/main/config", () => ({
  getModelConfig: mocks.getModelConfig,
}));
vi.mock("../src/main/validation", () => ({
  validateChatReadiness: mocks.validateChatReadiness,
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "default",
  profileHome: () => TEST_HOME,
  safeWriteFile: (path: string, content: string) => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const fs = require("fs");
    const pathModule = require("path");
    fs.mkdirSync(pathModule.dirname(path), { recursive: true });
    fs.writeFileSync(path, content);
  },
}));

import {
  activateOutcomeKit,
  enableOutcomeKitSchedule,
  evaluateOutcomeKitFixtures,
  getOutcomeKitReadiness,
  listOutcomeKits,
  registerOutcomeKitContent,
  runOutcomeKit,
} from "../src/main/outcome-kits";

function kit(): OutcomeKitDefinition {
  return {
    contractVersion: 1,
    kitId: "research-kit",
    title: "Research Kit",
    version: 1,
    outcome: "Produce a sourced brief.",
    inputs: [{ id: "topic", label: "Topic", required: true }],
    artifacts: [{ kind: "text", label: "Brief", required: true }],
    criteria: [{ id: "sourced", text: "Claims are sourced." }],
    dependencies: {
      skills: ["research/research-grounding"],
      connectors: [
        {
          server: "web-search",
          tool: "search",
          required: true,
          purpose: "Find sources.",
        },
      ],
      model: { capabilities: ["research"], requireVerified: true },
    },
    recipe: {
      name: "Research Kit",
      kind: "research-brief",
      description: "Sourced research.",
      job: "Research the topic.",
      inputs: "A topic.",
      output: "A sourced brief.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
    },
    reviewPolicy: "review-first",
    risk: { mode: "INTERACTIVE", classes: ["READ"] },
    triggerTemplates: ["manual", "scheduled"],
    scheduleTemplate: { cadence: "weekly", hour: 8 },
    evalFixtures: [
      {
        id: "basic",
        input: "AI safety",
        expectedCriteria: ["sourced"],
        expectedArtifactKinds: ["text"],
      },
    ],
    provenance: { publisher: "Fathah Hermes" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rmSync(join(TEST_HOME, "sps-agent"), { recursive: true, force: true });
  mocks.listInstalledSkills.mockReturnValue([
    { name: "research-grounding", category: "research" },
  ]);
  mocks.listMcpServers.mockResolvedValue([
    { name: "web-search", enabled: true, tools: [{ name: "search" }] },
  ]);
  mocks.getModelConfig.mockReturnValue({
    provider: "openai",
    model: "gpt-4.1",
  });
  mocks.validateChatReadiness.mockReturnValue({ ok: true });
  mocks.createAssistantRecipe.mockResolvedValue({
    ok: true,
    recipe: { id: "recipe-1", outcomeKitId: "research-kit" },
  });
  mocks.updateAssistantRecipe.mockResolvedValue({ ok: true });
  mocks.runAssistantRecipe.mockResolvedValue({
    ok: true,
    run: { id: "run-1" },
  });
});

describe("Outcome Kit lifecycle", () => {
  it("reports exact skill, connector, model, and runtime readiness", async () => {
    const readiness = await getOutcomeKitReadiness(kit(), "default");
    expect(readiness.status).toBe("attention");
    expect(readiness.canActivate).toBe(true);
    expect(readiness.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "skill:research/research-grounding",
          status: "ready",
        }),
        expect.objectContaining({
          id: "connector:web-search:search",
          status: "ready",
        }),
        expect.objectContaining({ id: "model", status: "ready" }),
        expect.objectContaining({ id: "schedule", status: "attention" }),
      ]),
    );
  });

  it("blocks missing required dependencies and unverified required models", async () => {
    mocks.listInstalledSkills.mockReturnValue([]);
    mocks.listMcpServers.mockResolvedValue([]);
    mocks.getModelConfig.mockReturnValue({
      provider: "custom",
      model: "private",
    });
    const readiness = await getOutcomeKitReadiness(kit(), "default");
    expect(readiness.status).toBe("blocked");
    expect(readiness.canActivate).toBe(false);
    expect(readiness.modelFitness.status).toBe("unverified");
  });

  it("installs content, activates without schedule or grants, then enables schedule separately", async () => {
    registerOutcomeKitContent(
      kit(),
      "a".repeat(64),
      ["research-grounding"],
      "default",
    );
    const storedBefore = JSON.parse(
      readFileSync(join(TEST_HOME, "sps-agent", "outcome-kits.json"), "utf-8"),
    );
    expect(storedBefore[0].recipeId).toBeUndefined();
    expect(storedBefore[0].scheduleEnabledAt).toBeUndefined();
    expect(JSON.stringify(storedBefore)).not.toMatch(
      /grant|credential|permission/i,
    );

    const activated = await activateOutcomeKit("research-kit", "default");
    expect(activated.ok).toBe(true);
    expect(mocks.createAssistantRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        outcomeKitId: "research-kit",
        reviewMode: "review-first",
      }),
      "default",
    );
    expect(mocks.createAssistantRecipe.mock.calls[0][0]).not.toHaveProperty(
      "schedule",
    );
    expect(mocks.updateAssistantRecipe).not.toHaveBeenCalled();

    const scheduled = await enableOutcomeKitSchedule("research-kit", "default");
    expect(scheduled.ok).toBe(true);
    expect(mocks.updateAssistantRecipe).toHaveBeenCalledWith(
      "recipe-1",
      { schedule: { enabled: true, cadence: "weekly", hour: 8 } },
      "default",
    );
    expect((await listOutcomeKits("default"))[0].scheduleEnabledAt).toEqual(
      expect.any(Number),
    );
  });

  it("requires declared inputs and triggers when running", async () => {
    registerOutcomeKitContent(
      kit(),
      "b".repeat(64),
      ["research-grounding"],
      "default",
    );
    await activateOutcomeKit("research-kit", "default");
    expect((await runOutcomeKit("research-kit", {}, "default")).error).toMatch(
      /Missing required inputs/,
    );
    expect(
      (
        await runOutcomeKit(
          "research-kit",
          { topic: "AI" },
          "default",
          "external",
        )
      ).error,
    ).toMatch(/not declared/);
    await runOutcomeKit("research-kit", { topic: "AI" }, "default", "manual");
    expect(mocks.runAssistantRecipe).toHaveBeenCalledWith(
      "recipe-1",
      "Topic: AI",
      "default",
      "manual",
    );
    expect(
      await runOutcomeKit("research-kit", { topic: 42 } as never, "default"),
    ).toEqual({
      ok: false,
      error: "Outcome Kit input values must be strings.",
    });
  });

  it("keeps evaluation fixtures tied to declared criteria and artifacts", () => {
    expect(evaluateOutcomeKitFixtures(kit())).toEqual({
      ok: true,
      failures: [],
    });
    const invalid = kit();
    invalid.evalFixtures[0].expectedCriteria = ["missing"];
    expect(evaluateOutcomeKitFixtures(invalid)).toEqual({
      ok: false,
      failures: ["basic: missing criterion missing"],
    });
  });
});
