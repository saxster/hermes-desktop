import { describe, expect, it } from "vitest";
import { uid } from "./ids";

describe("uid", () => {
  it("uses a cryptographically strong UUID while retaining the caller prefix", () => {
    expect(uid("pg")).toMatch(
      /^pg[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
