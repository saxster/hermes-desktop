import { describe, expect, it } from "vitest";
import {
  OUTCOME_KIT_CONTRACT_VERSION,
  validateOutcomeKit,
  type OutcomeKitDefinition,
} from "./outcome-kits";
import { resolveModelFitness } from "./model-fitness";

export function validOutcomeKit(): OutcomeKitDefinition {
  return {
    contractVersion: OUTCOME_KIT_CONTRACT_VERSION,
    kitId: "research-brief-kit",
    title: "Research Brief Kit",
    version: 1,
    outcome: "Produce a sourced research brief that is ready for review.",
    inputs: [{ id: "topic", label: "Topic", required: true }],
    artifacts: [
      { kind: "text", label: "Research brief", required: true },
      { kind: "transcript", label: "Run transcript", required: true },
    ],
    criteria: [{ id: "sources", text: "Every material claim has a source." }],
    dependencies: {
      skills: ["research/research-grounding"],
      connectors: [
        {
          server: "web-search",
          tool: "search",
          required: true,
          purpose: "Find authoritative sources.",
        },
      ],
      model: { capabilities: ["research", "writing"], requireVerified: true },
    },
    recipe: {
      name: "Research Brief Kit",
      kind: "research-brief",
      description: "Produces a sourced brief.",
      job: "Research the supplied topic and prepare a brief.",
      inputs: "A research topic.",
      output: "A sourced brief with evidence.",
      allowedActions: ["read_workspace", "search_web", "draft_content"],
    },
    reviewPolicy: "review-first",
    risk: { mode: "INTERACTIVE", classes: ["READ"] },
    triggerTemplates: ["manual", "scheduled"],
    scheduleTemplate: { cadence: "weekly", hour: 8 },
    evalFixtures: [
      {
        id: "basic",
        input: "AI agent safety",
        expectedCriteria: ["sources"],
        expectedArtifactKinds: ["text", "transcript"],
      },
    ],
    provenance: {
      publisher: "Fathah Hermes",
      sourceUrl: "https://example.com/research-brief-kit",
      sourceDate: "2026-07-24",
    },
  };
}

describe("validateOutcomeKit", () => {
  it("accepts a complete, review-first contract", () => {
    const result = validateOutcomeKit(validOutcomeKit());
    expect(result.ok).toBe(true);
    expect(result.kit?.kitId).toBe("research-brief-kit");
  });

  it("keeps permissions, credentials, and configuration outside the kit", () => {
    for (const field of [
      "grants",
      "permissions",
      "credentials",
      "configuration",
    ]) {
      const result = validateOutcomeKit({
        ...validOutcomeKit(),
        [field]: { allow: "*" },
      });
      expect(result.errors).toContain(
        `${field} must not be bundled with an Outcome Kit`,
      );
    }
  });

  it("forces high-risk and non-manual work through review", () => {
    const highRisk = validOutcomeKit();
    highRisk.reviewPolicy = "auto-apply";
    highRisk.risk = { mode: "SCOPED_AUTOMATION", classes: ["EXTERNAL"] };
    expect(validateOutcomeKit(highRisk).errors).toContain(
      "high-risk Outcome Kits must use review-first",
    );

    const scheduled = validOutcomeKit();
    scheduled.reviewPolicy = "auto-apply";
    scheduled.risk = { mode: "READ_ONLY", classes: ["READ"] };
    scheduled.artifacts = [{ kind: "text", label: "Brief", required: true }];
    expect(validateOutcomeKit(scheduled).errors).toContain(
      "scheduled, proposal, and external triggers must be review-first",
    );
  });

  it("fails closed on unknown actions, triggers, risks, schedules, and fixture references", () => {
    const raw = validOutcomeKit() as unknown as Record<string, unknown>;
    raw.recipe = {
      ...(raw.recipe as Record<string, unknown>),
      allowedActions: ["read_workspace", "launch_missiles"],
    };
    raw.triggerTemplates = ["manual", "surprise"];
    raw.risk = { mode: "INTERACTIVE", classes: ["READ", "MAGIC"] };
    raw.scheduleTemplate = { cadence: "hourly", hour: 99 };
    raw.evalFixtures = [
      {
        id: "bad",
        input: "x",
        expectedCriteria: ["missing"],
        expectedArtifactKinds: ["url"],
      },
    ];
    const result = validateOutcomeKit(raw);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/unsupported action/);
    expect(result.errors.join("\n")).toMatch(/unsupported trigger/);
    expect(result.errors.join("\n")).toMatch(/unsupported risk class/);
    expect(result.errors.join("\n")).toMatch(/scheduleTemplate\.cadence/);
    expect(result.errors.join("\n")).toMatch(/unknown criterion/);
    expect(result.errors.join("\n")).toMatch(/undeclared artifact/);
  });

  it("rejects malformed booleans, silently truncated arrays, and unsafe provenance", () => {
    const raw = validOutcomeKit() as unknown as Record<string, unknown>;
    raw.inputs = Array.from({ length: 51 }, (_, index) => ({
      id: `input-${index}`,
      label: `Input ${index}`,
      required: index === 0 ? "yes" : true,
    }));
    raw.dependencies = {
      ...(raw.dependencies as Record<string, unknown>),
      skills: ["research/research-grounding", 42],
      model: { capabilities: ["research"], requireVerified: "yes" },
    };
    raw.evalFixtures = [
      {
        id: "bad-types",
        input: "x",
        expectedCriteria: ["sources", 42],
        expectedArtifactKinds: ["text", "magic"],
      },
    ];
    raw.provenance = {
      publisher: "Unknown",
      sourceUrl: "javascript:alert(1)",
      sourceDate: "today",
    };
    const errors = validateOutcomeKit(raw).errors.join("\n");
    expect(errors).toMatch(/inputs must contain at most 50/);
    expect(errors).toMatch(/required must be boolean/);
    expect(errors).toMatch(/skills must contain only/);
    expect(errors).toMatch(/requireVerified must be boolean/);
    expect(errors).toMatch(/expectedCriteria must contain only strings/);
    expect(errors).toMatch(/unsupported kind/);
    expect(errors).toMatch(
      /sourceUrl must be an http\(s\) URL or safe relative path/,
    );
    expect(errors).toMatch(/sourceDate must use YYYY-MM-DD/);
  });
});

describe("resolveModelFitness", () => {
  it("requires an exact provider and model match with source-backed evidence", () => {
    const verified = resolveModelFitness("openai", "gpt-4.1", ["research"]);
    expect(verified.status).toBe("verified");
    expect(verified.evidence?.sourceUrl).toBe(
      "https://developers.openai.com/api/docs/models/gpt-4.1",
    );
    expect(verified.evidence?.verifiedAt).toBe("2026-07-24");

    expect(
      resolveModelFitness("openai", "gpt-4.1-latest", ["research"]).status,
    ).toBe("unverified");
    expect(resolveModelFitness("custom", "gpt-4.1", ["research"]).status).toBe(
      "unverified",
    );
  });
});
