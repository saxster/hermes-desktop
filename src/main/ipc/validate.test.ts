import { join, resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  assertIpcNumber,
  assertIpcRecord,
  assertIpcString,
  assertOptionalIpcRecord,
  assertPathInside,
  normalizeIpcProfile,
} from "./validate";

describe("assertIpcString", () => {
  it("accepts strings and rejects non-strings", () => {
    expect(assertIpcString("home", "page id")).toBe("home");
    expect(() => assertIpcString(42, "page id")).toThrow(/page id/i);
    expect(() => assertIpcString(null, "page id")).toThrow(/page id/i);
  });

  it("rejects null bytes", () => {
    expect(() => assertIpcString("home\u0000evil", "page id")).toThrow(
      /null byte/i,
    );
  });
});

describe("assertIpcNumber", () => {
  it("accepts finite numbers and rejects non-numbers and non-finite values", () => {
    expect(assertIpcNumber(0, "read status")).toBe(0);
    expect(assertIpcNumber(3.5, "read status")).toBe(3.5);
    expect(() => assertIpcNumber("1", "read status")).toThrow(/read status/i);
    expect(() => assertIpcNumber(undefined, "read status")).toThrow(
      /read status/i,
    );
    expect(() => assertIpcNumber(Number.NaN, "read status")).toThrow(
      /read status/i,
    );
    expect(() => assertIpcNumber(Infinity, "read status")).toThrow(
      /read status/i,
    );
  });
});

describe("assertIpcRecord", () => {
  it("accepts plain objects and rejects arrays, null, and primitives", () => {
    expect(assertIpcRecord({ a: 1 }, "payload")).toEqual({ a: 1 });
    for (const bad of [null, [], "x", 42, true]) {
      expect(() => assertIpcRecord(bad, "payload")).toThrow(/payload/i);
    }
  });
});

describe("assertOptionalIpcRecord", () => {
  it("passes undefined through and guards present values", () => {
    expect(assertOptionalIpcRecord(undefined, "payload")).toBeUndefined();
    expect(assertOptionalIpcRecord({ a: 1 }, "payload")).toEqual({ a: 1 });
    expect(() => assertOptionalIpcRecord([], "payload")).toThrow(/payload/i);
  });
});

describe("normalizeIpcProfile", () => {
  it("normalizes default-ish profiles through the canonical profile rules", () => {
    expect(normalizeIpcProfile()).toBeUndefined();
    expect(normalizeIpcProfile("")).toBeUndefined();
    expect(normalizeIpcProfile("default")).toBeUndefined();
    expect(normalizeIpcProfile("work_1-prod")).toBe("work_1-prod");
  });

  it("rejects traversal, ambiguous, and malformed profiles", () => {
    for (const value of ["../x", "/tmp/profile", "work\u0000x", ".hidden"]) {
      expect(() => normalizeIpcProfile(value)).toThrow(/profile/i);
    }
  });
});

describe("assertPathInside", () => {
  const root = resolve("/tmp/hermes-vault");

  it("resolves a safe relative path inside the root", () => {
    expect(assertPathInside(root, "pages/home.md", "page path")).toBe(
      join(root, "pages", "home.md"),
    );
  });

  it("rejects traversal, absolute paths, dot segments, and null bytes", () => {
    for (const value of [
      "../escape.md",
      "pages/../../escape.md",
      "/tmp/escape.md",
      String.raw`C:\tmp\escape.md`,
      String.raw`\\server\share\escape.md`,
      "pages/./home.md",
      "pages//home.md",
      "home\u0000evil.md",
    ]) {
      expect(() => assertPathInside(root, value, "page path")).toThrow(
        /page path/i,
      );
    }
  });
});
