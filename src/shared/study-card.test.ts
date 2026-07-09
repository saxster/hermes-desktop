import { describe, expect, it } from "vitest";
import {
  buildDeckInputFromStudyCard,
  buildStudyCardPrompt,
  computeTimeEconomics,
  enrichStudyCardMarkdown,
  estimateReadMinutes,
  extractTimeSavedLine,
  formatTimeSavedLine,
  formatTimestamp,
  hasStudyCardSources,
  parseStudyCardMarkdown,
  parseTimestampToSeconds,
  studyCardToMarkdown,
  youtubeTimestampUrl,
  type StudyCard,
} from "./study-card";

const SAMPLE_MARKDOWN = [
  "# Why Procrastinators Procrastinate",
  "",
  "## Big takeaway",
  "A Rational Decision-Maker battles an Instant Gratification Monkey until deadlines summon the Panic Monster.",
  "",
  "## Time economics",
  "- Source: 14 min",
  "- Read: 3 min",
  "- Saved: 11 min",
  "",
  "## Sections",
  "",
  "### The Brain Model",
  "- Three characters run the procrastinator mind",
  "- The monkey hijacks the plan",
  "",
  "### Two Types of Procrastination",
  "- Deadline-based is a short crisis",
  "- Non-deadline is the long trap",
  "",
  "## Notable quotes",
  "",
  "> The Monkey does not like that plan, so he actually takes the wheel.",
  "— Tim Urban [4:17]",
  "",
  "## Sources",
  "",
  "- [TED Talk](https://www.youtube.com/watch?v=arj7oStGLkU)",
].join("\n");

describe("buildStudyCardPrompt", () => {
  it("includes focus, corpus, duration, and required sections", () => {
    const out = buildStudyCardPrompt("procrastination models", {
      corpusDescription:
        "https://www.youtube.com/watch?v=arj7oStGLkU transcript",
      sourceDurationSeconds: 844,
      theme: "notebook",
    });

    expect(out).toContain("procrastination models");
    expect(out).toContain("youtube.com/watch?v=arj7oStGLkU");
    expect(out).toContain("844 seconds");
    expect(out).toContain("notebook");
    for (const heading of [
      "## Big takeaway",
      "## Time economics",
      "## Sections",
      "## Notable quotes",
      "## Sources",
    ]) {
      expect(out).toContain(heading);
    }
    expect(out).toContain("Do not invent sources");
    expect(out).toContain("not a Curated Brief");
  });

  it("falls back to defaults when focus is blank", () => {
    const out = buildStudyCardPrompt("   ");
    expect(out).toContain("the provided source corpus");
  });
});

describe("time economics", () => {
  it("estimates read minutes from word count", () => {
    const words = Array.from({ length: 440 }, () => "word").join(" ");
    expect(estimateReadMinutes(words)).toBe(2);
  });

  it("computes saved minutes from source duration", () => {
    const econ = computeTimeEconomics(840, "short body text only");
    expect(econ?.sourceMinutes).toBe(14);
    expect(econ?.readMinutes).toBeGreaterThanOrEqual(1);
    expect(econ!.savedMinutes).toBe(
      Math.max(0, econ!.sourceMinutes - econ!.readMinutes),
    );
  });

  it("formats the Glimpse-style time-saved line", () => {
    expect(
      formatTimeSavedLine({
        sourceMinutes: 14,
        readMinutes: 3,
        savedMinutes: 11,
      }),
    ).toBe("14 min source · 3 min read · You just saved 11 min.");
  });
});

describe("timestamps", () => {
  it("formats and parses mm:ss and h:mm:ss", () => {
    expect(formatTimestamp(257)).toBe("4:17");
    expect(formatTimestamp(3661)).toBe("1:01:01");
    expect(parseTimestampToSeconds("4:17")).toBe(257);
    expect(parseTimestampToSeconds("1:01:01")).toBe(3661);
  });

  it("appends YouTube t= deep links", () => {
    const linked = youtubeTimestampUrl(
      "https://www.youtube.com/watch?v=arj7oStGLkU",
      257,
    );
    expect(linked).toContain("t=257s");
    expect(linked).toContain("v=arj7oStGLkU");
  });

  it("leaves non-YouTube URLs unchanged", () => {
    expect(youtubeTimestampUrl("https://example.com/a", 30)).toBe(
      "https://example.com/a",
    );
  });
});

describe("parse + serialize", () => {
  it("parses model markdown into IR", () => {
    const card = parseStudyCardMarkdown(SAMPLE_MARKDOWN);
    expect(card).not.toBeNull();
    expect(card!.title).toBe("Why Procrastinators Procrastinate");
    expect(card!.takeaway).toContain("Instant Gratification Monkey");
    expect(card!.sections).toHaveLength(2);
    expect(card!.sections[0].title).toBe("The Brain Model");
    expect(card!.quotes[0].speaker).toBe("Tim Urban");
    expect(card!.quotes[0].timestampSeconds).toBe(257);
    expect(card!.sources[0].url).toContain("youtube.com");
    expect(card!.economics?.savedMinutes).toBe(11);
  });

  it("round-trips through studyCardToMarkdown", () => {
    const card = parseStudyCardMarkdown(SAMPLE_MARKDOWN)!;
    const md = studyCardToMarkdown(card);
    expect(md).toContain("type: study-card");
    expect(md).toContain("## Big takeaway");
    expect(md).toContain("You just saved 11 min");
    expect(md).toContain("[4:17]");
    expect(hasStudyCardSources(md)).toBe(true);

    const again = parseStudyCardMarkdown(md);
    expect(again?.title).toBe(card.title);
    expect(again?.quotes[0].timestampSeconds).toBe(257);
    expect(again?.economics?.savedMinutes).toBe(11);
  });

  it("enriches freeform markdown with known duration", () => {
    const freeform = [
      "# Loop engineering",
      "",
      "## Big takeaway",
      "Agents need an outer autonomy loop.",
      "",
      "## Sections",
      "",
      "### Core idea",
      "- Self-prompt the next step",
      "",
      "## Sources",
      "",
      "- [Video](https://www.youtube.com/watch?v=abc123)",
    ].join("\n");

    const enriched = enrichStudyCardMarkdown(freeform, {
      sourceDurationSeconds: 533,
      theme: "clean",
    });
    expect(enriched).toContain("## Time economics");
    expect(enriched).toMatch(/Source:\s*\d+\s*min/);
    expect(hasStudyCardSources(enriched)).toBe(true);
  });
});

describe("hasStudyCardSources", () => {
  it("requires Sources heading and a URL", () => {
    expect(hasStudyCardSources(SAMPLE_MARKDOWN)).toBe(true);
    expect(hasStudyCardSources("## Sources\n- memory only")).toBe(false);
    expect(hasStudyCardSources("Body https://a.example")).toBe(false);
  });
});

describe("deck handoff", () => {
  it("builds a research-themed deck input", () => {
    const card = parseStudyCardMarkdown(SAMPLE_MARKDOWN)!;
    const input = buildDeckInputFromStudyCard(card as StudyCard);
    expect(input.title).toBe(card.title);
    expect(input.theme).toBe("research");
    expect(input.notes).toContain("Big takeaway");
    expect(input.sourceRefs?.[0]?.kind).toBe("research");
  });
});

describe("extractTimeSavedLine", () => {
  it("pulls economics from structured markdown", () => {
    expect(extractTimeSavedLine(SAMPLE_MARKDOWN)).toContain(
      "You just saved 11 min",
    );
  });
});
