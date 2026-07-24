import { describe, expect, it } from "vitest";
import {
  skillPackSkillToMarkdown,
  validateSkillPack,
  type SkillPack,
} from "./skill-packs";

function goodPack(): SkillPack {
  return {
    packId: "workspace-engine",
    title: "SPS Workspace Engine",
    version: 1,
    skills: [
      {
        name: "sps-workspace-layout",
        description: "Read or navigate the owner's SPS workspace.",
        body: "# Layout\n\nRules.",
      },
      {
        name: "sps-inbox-workflows",
        category: "inbox",
        description: "Help process the SPS inbox.",
        body: "# Inbox\n\nWorkflows.",
        files: { "main.py": "print('hi')\n" },
      },
    ],
  };
}

describe("validateSkillPack", () => {
  it("accepts a well-formed pack", () => {
    const result = validateSkillPack(goodPack());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.pack?.skills).toHaveLength(2);
  });

  it("rejects bad ids, versions, and empty skills", () => {
    expect(
      validateSkillPack({
        packId: "Bad Id",
        title: "x",
        version: 1,
        skills: [{}],
      }).ok,
    ).toBe(false);
    expect(
      validateSkillPack({ packId: "ok", title: "x", version: 0, skills: [{}] })
        .ok,
    ).toBe(false);
    expect(
      validateSkillPack({ packId: "ok", title: "x", version: 1, skills: [] })
        .ok,
    ).toBe(false);
    expect(validateSkillPack(null).ok).toBe(false);
  });

  it("rejects bad skill shapes", () => {
    const base = goodPack();
    const badName = validateSkillPack({
      ...base,
      skills: [{ ...base.skills[0], name: "Not A Slug" }],
    });
    expect(badName.ok).toBe(false);
    const noBody = validateSkillPack({
      ...base,
      skills: [{ ...base.skills[0], body: "  " }],
    });
    expect(noBody.ok).toBe(false);
    const longDesc = validateSkillPack({
      ...base,
      skills: [{ ...base.skills[0], description: "x".repeat(201) }],
    });
    expect(longDesc.ok).toBe(false);
  });

  it("rejects duplicate and unsafe file paths", () => {
    const base = goodPack();
    const dup = validateSkillPack({
      ...base,
      skills: [base.skills[0], base.skills[0]],
    });
    expect(dup.ok).toBe(false);
    const traversal = validateSkillPack({
      ...base,
      skills: [{ ...base.skills[0], files: { "../escape.txt": "x" } }],
    });
    expect(traversal.ok).toBe(false);
  });

  it("rejects a bad category", () => {
    const base = goodPack();
    expect(
      validateSkillPack({
        ...base,
        skills: [{ ...base.skills[0], category: "NOPE" }],
      }).ok,
    ).toBe(false);
  });

  it("validates an Outcome Kit inside the skill pack and requires matching ids", () => {
    const base = goodPack();
    const outcomeKit = {
      contractVersion: 1,
      kitId: base.packId,
      title: "Workspace Outcome Kit",
      version: 1,
      outcome: "Produce a workspace brief.",
      inputs: [{ id: "topic", label: "Topic", required: true }],
      artifacts: [{ kind: "text", label: "Brief", required: true }],
      criteria: [{ id: "complete", text: "The brief is complete." }],
      dependencies: {
        skills: [],
        connectors: [],
        model: { capabilities: ["writing"], requireVerified: false },
      },
      recipe: {
        name: "Workspace brief",
        kind: "custom",
        description: "Prepare a brief.",
        job: "Prepare a brief.",
        inputs: "A topic.",
        output: "A brief.",
        allowedActions: ["read_workspace", "draft_content"],
      },
      reviewPolicy: "review-first",
      risk: { mode: "INTERACTIVE", classes: ["READ"] },
      triggerTemplates: ["manual"],
      evalFixtures: [
        {
          id: "basic",
          input: "Status",
          expectedCriteria: ["complete"],
          expectedArtifactKinds: ["text"],
        },
      ],
      provenance: { publisher: "Fathah Hermes" },
    };
    expect(validateSkillPack({ ...base, outcomeKit }).ok).toBe(true);
    expect(
      validateSkillPack({
        ...base,
        outcomeKit: { ...outcomeKit, kitId: "different" },
      }).errors,
    ).toContain("outcomeKit.kitId must match packId");
  });
});

describe("skillPackSkillToMarkdown", () => {
  it("renders frontmatter + body, escaping quotes in the description", () => {
    const markdown = skillPackSkillToMarkdown({
      name: "demo",
      description: 'Use when "testing" things.',
      body: "# Demo\n",
    });
    expect(markdown).toBe(
      '---\nname: "demo"\ndescription: "Use when \\"testing\\" things."\n---\n\n# Demo\n',
    );
  });
});
