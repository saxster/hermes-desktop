import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parse } from "yaml";

const ROOT = join(__dirname, "..");

function workflow(name: string): Record<string, unknown> {
  return parse(
    readFileSync(join(ROOT, ".github", "workflows", name), "utf-8"),
  ) as Record<string, unknown>;
}

describe("GitHub workflows", () => {
  it.each(["ci.yml", "release.yml"])("parses %s as YAML", (name) => {
    expect(workflow(name)).toHaveProperty("jobs");
  });

  it("gates every release build on the release-source verification job", () => {
    const release = workflow("release.yml") as {
      jobs: Record<string, { needs?: string[] }>;
    };

    expect(release.jobs.verify).toBeDefined();
    for (const job of ["release_mac", "release_linux", "release_windows"]) {
      expect(release.jobs[job].needs).toEqual(["prepare", "verify"]);
    }
  });
});
