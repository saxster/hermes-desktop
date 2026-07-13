import { afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const originalHome = process.env.HOME;
const originalHermesHome = process.env.HERMES_HOME;
const testHome = mkdtempSync(join(tmpdir(), "hermes-vitest-"));

process.env.HOME = testHome;
delete process.env.HERMES_HOME;

afterAll(() => {
  rmSync(testHome, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalHermesHome === undefined) {
    delete process.env.HERMES_HOME;
  } else {
    process.env.HERMES_HOME = originalHermesHome;
  }
});
