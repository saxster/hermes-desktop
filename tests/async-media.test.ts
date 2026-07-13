import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), `hermes-async-media-test-${process.pid}`);
const ORIGINAL_HERMES_HOME = process.env.HERMES_HOME;

async function loadMedia(): Promise<typeof import("../src/main/media")> {
  vi.resetModules();
  return import("../src/main/media");
}

describe("authorized async media", () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, "home", "media-output"), { recursive: true });
    process.env.HERMES_HOME = join(TEST_DIR, "home");
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    if (ORIGINAL_HERMES_HOME === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = ORIGINAL_HERMES_HOME;
  });

  it("reads an agent-output image asynchronously as a data URL", async () => {
    const { readMediaAsDataUrl } = await loadMedia();
    const filePath = join(TEST_DIR, "home", "media-output", "test.png");
    writeFileSync(filePath, "dummy-png-data");

    const promise = readMediaAsDataUrl(filePath);
    expect(promise).toBeInstanceOf(Promise);
    await expect(promise).resolves.toBe(
      "data:image/png;base64,ZHVtbXktcG5nLWRhdGE=",
    );
  });

  it("rejects an ungranted image outside the agent-output directory", async () => {
    const { mediaFileExists, readMediaAsDataUrl } = await loadMedia();
    const filePath = join(TEST_DIR, "secret.png");
    writeFileSync(filePath, "secret");

    await expect(readMediaAsDataUrl(filePath)).resolves.toBeNull();
    expect(mediaFileExists(filePath)).toBe(false);
  });

  it("uses realpaths so a symlink cannot escape the agent-output directory", async () => {
    const { readMediaAsDataUrl } = await loadMedia();
    const outside = join(TEST_DIR, "secret.png");
    const link = join(TEST_DIR, "home", "media-output", "link.png");
    writeFileSync(outside, "secret");
    symlinkSync(outside, link);

    await expect(readMediaAsDataUrl(link)).resolves.toBeNull();
  });

  it("returns null for unsupported extensions and missing files", async () => {
    const { readMediaAsDataUrl } = await loadMedia();
    const textPath = join(TEST_DIR, "home", "media-output", "test.txt");
    writeFileSync(textPath, "plain text");

    await expect(readMediaAsDataUrl(textPath)).resolves.toBeNull();
    await expect(
      readMediaAsDataUrl(join(TEST_DIR, "home", "media-output", "missing.png")),
    ).resolves.toBeNull();
  });
});
