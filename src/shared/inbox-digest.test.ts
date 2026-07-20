import { describe, expect, it } from "vitest";
import {
  capturedAtMs,
  INBOX_DIGEST_MAX_CAPTURES,
  isNewsletterCapture,
  localDateKey,
  localDayStartMs,
  selectDigestCaptures,
  type DigestCandidateRow,
} from "./inbox-digest";

function row(path: string, props: Record<string, unknown>): DigestCandidateRow {
  return { path, props, mtime: 0 };
}

describe("capturedAtMs", () => {
  it("reads numeric and string capturedAt", () => {
    expect(capturedAtMs({ capturedAt: 123 })).toBe(123);
    expect(capturedAtMs({ capturedAt: "456" })).toBe(456);
  });

  it("returns 0 for missing or bogus values", () => {
    expect(capturedAtMs({})).toBe(0);
    expect(capturedAtMs({ capturedAt: "nope" })).toBe(0);
  });
});

describe("isNewsletterCapture", () => {
  it("accepts boolean and string forms", () => {
    expect(isNewsletterCapture({ digest: true })).toBe(true);
    expect(isNewsletterCapture({ digest: "true" })).toBe(true);
    expect(isNewsletterCapture({ digest: false })).toBe(false);
    expect(isNewsletterCapture({})).toBe(false);
  });
});

describe("localDayStartMs / localDateKey", () => {
  it("computes local midnight", () => {
    const d = new Date(2026, 6, 19, 18, 30, 45);
    expect(new Date(localDayStartMs(d)).getHours()).toBe(0);
    expect(localDateKey(d)).toBe("2026-07-19");
  });
});

describe("selectDigestCaptures", () => {
  const dayStart = localDayStartMs(new Date(2026, 6, 19, 18, 0));

  it("keeps only the day's email captures, newest first", () => {
    const rows = [
      row("_inbox/old.md", { source: "email", capturedAt: dayStart - 1 }),
      row("_inbox/note.md", { source: "note", capturedAt: dayStart + 5 }),
      row("_inbox/a.md", { source: "email", capturedAt: dayStart + 10 }),
      row("_inbox/b.md", { source: "email", capturedAt: dayStart + 20 }),
    ];
    expect(selectDigestCaptures(rows, dayStart).map((r) => r.path)).toEqual([
      "_inbox/b.md",
      "_inbox/a.md",
    ]);
  });

  it("tolerates string capturedAt", () => {
    const rows = [
      row("_inbox/a.md", { source: "email", capturedAt: String(dayStart + 1) }),
    ];
    expect(selectDigestCaptures(rows, dayStart)).toHaveLength(1);
  });

  it("caps the selection for the prompt budget", () => {
    const rows = Array.from(
      { length: INBOX_DIGEST_MAX_CAPTURES + 10 },
      (_, i) =>
        row(`_inbox/c${i}.md`, { source: "email", capturedAt: dayStart + i }),
    );
    expect(selectDigestCaptures(rows, dayStart)).toHaveLength(
      INBOX_DIGEST_MAX_CAPTURES,
    );
  });
});
