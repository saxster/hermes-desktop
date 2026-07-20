import { describe, expect, it } from "vitest";
import {
  buildMailtoUrl,
  extractEmailAddress,
  isPlausibleEmail,
  MAILTO_BODY_MAX_CHARS,
  replySubject,
} from "./email-actions";

describe("isPlausibleEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isPlausibleEmail("ravi@example.net")).toBe(true);
    expect(isPlausibleEmail("a.b+tag@sub.domain.co")).toBe(true);
  });

  it("rejects non-addresses", () => {
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail("not-an-email")).toBe(false);
    expect(isPlausibleEmail("missing@tld")).toBe(false);
    expect(isPlausibleEmail("two @ addresses.com")).toBe(false);
  });
});

describe("extractEmailAddress", () => {
  it("pulls the address out of a display-name string", () => {
    expect(extractEmailAddress("Ravi Menon <ravi@example.net>")).toBe(
      "ravi@example.net",
    );
  });

  it("accepts a bare address", () => {
    expect(extractEmailAddress("  ravi@example.net ")).toBe("ravi@example.net");
  });

  it("returns empty for unparseable input", () => {
    expect(extractEmailAddress("Ravi Menon")).toBe("");
    expect(extractEmailAddress("")).toBe("");
  });
});

describe("replySubject", () => {
  it("prefixes once", () => {
    expect(replySubject("Pricing question")).toBe("Re: Pricing question");
    expect(replySubject("Re: Pricing question")).toBe("Re: Pricing question");
    expect(replySubject("RE: Pricing question")).toBe("RE: Pricing question");
  });

  it("handles an empty subject", () => {
    expect(replySubject("   ")).toBe("Re: (no subject)");
  });
});

describe("buildMailtoUrl", () => {
  it("builds an encoded mailto URL", () => {
    const url = buildMailtoUrl({
      to: "ravi@example.net",
      subject: "Re: Pricing & terms",
      body: "Line one\nLine two",
    });
    expect(url).toBe(
      `mailto:ravi%40example.net?subject=${encodeURIComponent(
        "Re: Pricing & terms",
      )}&body=${encodeURIComponent("Line one\nLine two")}`,
    );
  });

  it("accepts a display-name recipient", () => {
    const url = buildMailtoUrl({
      to: "Ravi Menon <ravi@example.net>",
      subject: "Hi",
      body: "Body",
    });
    expect(url?.startsWith("mailto:ravi%40example.net?")).toBe(true);
  });

  it("returns null for an implausible recipient", () => {
    expect(buildMailtoUrl({ to: "nobody", subject: "Hi", body: "x" })).toBe(
      null,
    );
  });

  it("caps the handed-off body for URL safety", () => {
    const long = "x".repeat(MAILTO_BODY_MAX_CHARS + 500);
    const url = buildMailtoUrl({ to: "a@b.co", subject: "s", body: long });
    expect(url).not.toBeNull();
    const bodyParam = /[?&]body=([^&]*)$/.exec(url as string)?.[1] ?? "";
    const decoded = decodeURIComponent(bodyParam);
    expect(decoded.length).toBeLessThanOrEqual(MAILTO_BODY_MAX_CHARS);
    expect(decoded.endsWith("…")).toBe(true);
  });
});
