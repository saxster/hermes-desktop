import { describe, expect, it } from "vitest";
import {
  buildDailyBriefMarkdown,
  dailyBriefFileName,
  extractOptedInDailyBrief,
} from "./daily-brief";

describe("daily brief capsules", () => {
  it("uses a stable Daily Brief filename", () => {
    expect(dailyBriefFileName(new Date("2026-06-26T12:00:00.000Z"))).toBe(
      "Daily Brief - 2026-06-26.md",
    );
  });

  it("uses the local calendar date near a UTC day boundary", () => {
    const originalTimeZone = process.env.TZ;
    process.env.TZ = "Asia/Kolkata";

    try {
      const localJuneTwentySix = new Date("2026-06-25T20:00:00.000Z");

      expect(dailyBriefFileName(localJuneTwentySix)).toBe(
        "Daily Brief - 2026-06-26.md",
      );
      expect(
        buildDailyBriefMarkdown({
          date: localJuneTwentySix,
          body: "",
        }),
      ).toContain('title: "Daily Brief - 2026-06-26"');
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  it("wraps generated content in review-first frontmatter", () => {
    const markdown = buildDailyBriefMarkdown({
      date: new Date("2026-06-26T12:00:00.000Z"),
      body: "# Daily Brief - 2026-06-26\n\nOpen loops.",
    });

    expect(markdown).toContain('title: "Daily Brief - 2026-06-26"');
    expect(markdown).toContain("kind: daily-brief");
    expect(markdown).toContain("context: review");
    expect(markdown).toContain("# Daily Brief - 2026-06-26");
  });

  // Regression, 2026-07-25: the Dream Cycle prompt names `context: review`, so the
  // model opened its response with its own frontmatter block and the wrapper added
  // a second one. Real artifact: ~/.hermes/sps-agent/vault/Daily Brief - 2026-07-25.md
  it("does not double-wrap frontmatter the model emitted itself", () => {
    const markdown = buildDailyBriefMarkdown({
      date: new Date("2026-07-25T12:00:00.000Z"),
      body: "---\ncontext: review\n---\n\n## Open Loops\n\nNone.",
    });

    const fenceCount = markdown.split("\n").filter((l) => l === "---").length;
    expect(fenceCount).toBe(2);
    expect(markdown).not.toContain("---\n---");
    expect(markdown).toContain("## Open Loops");
    expect(markdown).toContain('title: "Daily Brief - 2026-07-25"');
  });

  it("keeps the opt-in flag readable when the model emitted its own frontmatter", () => {
    const optedIn = buildDailyBriefMarkdown({
      date: new Date("2026-07-25T12:00:00.000Z"),
      body: "---\ncontext: review\n---\n\nBody text.",
    }).replace("context: review", "context: include");

    expect(extractOptedInDailyBrief(optedIn)).toBe("Body text.");
  });

  it("leaves a leading horizontal rule alone", () => {
    const markdown = buildDailyBriefMarkdown({
      date: new Date("2026-07-25T12:00:00.000Z"),
      body: "---\n\nJust a rule, not frontmatter.",
    });

    expect(markdown).toContain("Just a rule, not frontmatter.");
    expect(markdown).toContain("---\n---\n\nJust a rule");
  });

  it("only extracts a daily brief for assistant context after markdown opt-in", () => {
    const review = buildDailyBriefMarkdown({
      date: new Date("2026-06-26T12:00:00.000Z"),
      body: "# Daily Brief - 2026-06-26\n\nReview me first.",
    });
    const include = review.replace("context: review", "context: include");

    expect(extractOptedInDailyBrief(review)).toBe("");
    expect(extractOptedInDailyBrief(include)).toContain("Review me first.");
  });
});
