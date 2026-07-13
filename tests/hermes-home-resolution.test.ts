import { afterEach, describe, expect, it } from "vitest";
import { join } from "path";
import { tmpdir } from "os";
import { profileHome } from "../src/main/utils";

const originalHermesHome = process.env.HERMES_HOME;

afterEach(() => {
  if (originalHermesHome === undefined) {
    delete process.env.HERMES_HOME;
  } else {
    process.env.HERMES_HOME = originalHermesHome;
  }
});

describe("Hermes home resolution", () => {
  it("starts every test file outside the owner's Hermes home", () => {
    expect(profileHome().startsWith(tmpdir())).toBe(true);
  });

  it("follows HERMES_HOME changes made after the path module is imported", () => {
    process.env.HERMES_HOME = "/tmp/hermes-home-one";
    expect(profileHome("default")).toBe("/tmp/hermes-home-one");

    process.env.HERMES_HOME = "/tmp/hermes-home-two";
    expect(profileHome("work")).toBe(
      join("/tmp/hermes-home-two", "profiles", "work"),
    );
  });
});
