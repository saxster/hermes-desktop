import { describe, expect, it } from "vitest";
import {
  detectTranscriptFormat,
  matchPersonId,
  normalizeTranscript,
  normalizeTranscriptImport,
  parseMeetingExtraction,
  parseTranscript,
  transcriptSpeakers,
} from "./meeting";

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Alice: Kickoff for the Phoenix launch.

00:00:05.000 --> 00:00:09.000
<v Bob>Bob: noted, I'll own the deck.</v>

00:00:10.000 --> 00:00:12.000
Alice: Thanks.
`;

const SRT = `1
00:00:01,000 --> 00:00:04,000
Alice: Kickoff for the Phoenix launch.

2
00:00:05,000 --> 00:00:09,000
Bob: noted, I'll own the deck.
`;

const PLAIN = `Alice: Kickoff for the Phoenix launch.
and a quick review of scope.
Bob: noted, I'll own the deck.

Random narration line without a speaker.`;

describe("detectTranscriptFormat", () => {
  it("detects the three supported formats", () => {
    expect(detectTranscriptFormat(VTT)).toBe("vtt");
    expect(detectTranscriptFormat(SRT)).toBe("srt");
    expect(detectTranscriptFormat(PLAIN)).toBe("plain");
  });
});

describe("parseTranscript", () => {
  it("parses VTT cues with speakers and timestamps", () => {
    const segments = parseTranscript(VTT);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({
      speaker: "Alice",
      text: "Kickoff for the Phoenix launch.",
      ts: "00:00:01.000",
    });
    expect(segments[1].speaker).toBe("Bob");
    expect(segments[1].text).toBe("noted, I'll own the deck.");
  });

  it("parses SRT cues", () => {
    const segments = parseTranscript(SRT);
    expect(segments).toHaveLength(2);
    expect(segments[1].speaker).toBe("Bob");
  });

  it("parses plain text, folding continuations into the speaker's turn", () => {
    const segments = parseTranscript(PLAIN);
    expect(segments.map((s) => s.speaker)).toEqual(["Alice", "Bob"]);
    expect(segments[0].text).toContain("review of scope");
    // An unlabeled line reads as a wrapped turn, not a new speaker.
    expect(segments[1].text).toContain("Random narration line");
  });

  it("does not treat prose colons as speakers", () => {
    const segments = parseTranscript("note: this is lowercase");
    expect(segments[0].speaker).toBe("");
  });
});

describe("normalizeTranscript / transcriptSpeakers", () => {
  it("merges consecutive same-speaker segments", () => {
    const normalized = normalizeTranscript(parseTranscript(VTT));
    expect(normalized).toContain("Alice: Kickoff for the Phoenix launch.");
    expect(normalized).toContain("Bob: noted, I'll own the deck.");
  });

  it("collects unique speakers in first-seen order", () => {
    expect(transcriptSpeakers(parseTranscript(VTT))).toEqual(["Alice", "Bob"]);
  });
});

describe("normalizeTranscriptImport", () => {
  it("accepts content and trims title", () => {
    expect(
      normalizeTranscriptImport({ title: "  Sync  ", content: "Alice: hi" }),
    ).toEqual({ title: "Sync", content: "Alice: hi" });
  });

  it("rejects empty or malformed input", () => {
    expect(normalizeTranscriptImport(null)).toBe(null);
    expect(normalizeTranscriptImport({ content: "   " })).toBe(null);
    expect(normalizeTranscriptImport({ content: 42 })).toBe(null);
  });
});

describe("parseMeetingExtraction", () => {
  it("coerces a well-formed payload", () => {
    const extraction = parseMeetingExtraction({
      summary: "Launch is on track.",
      decisions: ["Ship Friday"],
      actionItems: [
        { title: "Draft the deck", who: "Bob", due: "2026-07-24" },
        { title: "Follow up with design", who: "", due: "not-a-date" },
        { title: "" },
      ],
    });
    expect(extraction.summary).toBe("Launch is on track.");
    expect(extraction.decisions).toEqual(["Ship Friday"]);
    expect(extraction.actionItems).toEqual([
      { title: "Draft the deck", who: "Bob", due: "2026-07-24" },
      { title: "Follow up with design" },
    ]);
  });

  it("degrades garbage to an empty extraction", () => {
    expect(parseMeetingExtraction("nope")).toEqual({
      summary: "",
      decisions: [],
      actionItems: [],
    });
    expect(parseMeetingExtraction({ actionItems: "yes" }).actionItems).toEqual(
      [],
    );
  });
});

describe("matchPersonId", () => {
  const persons = [
    { id: "ravi-menon", name: "Ravi Menon", aliases: ["RM"] },
    { id: "jane-doe", name: "Jane Doe" },
    { id: "jane-smith", name: "Jane Smith" },
  ];

  it("matches exact names and aliases case-insensitively", () => {
    expect(matchPersonId("ravi menon", persons)).toBe("ravi-menon");
    expect(matchPersonId("RM", persons)).toBe("ravi-menon");
  });

  it("matches an unambiguous first name", () => {
    expect(matchPersonId("Ravi", persons)).toBe("ravi-menon");
  });

  it("refuses ambiguous or unknown names", () => {
    expect(matchPersonId("Jane", persons)).toBe(null);
    expect(matchPersonId("Nobody", persons)).toBe(null);
    expect(matchPersonId("", persons)).toBe(null);
  });
});
