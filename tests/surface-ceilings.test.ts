// surface-ceilings.test.ts — descending ceilings on the two numbers that only
// ever grew: the IPC channel count and the top-level Surface count.
//
// Why a ceiling and not an exact list: an exact list (see sps-ipc-surface.test.ts)
// pins a subset and has to be edited on every legitimate change, so it stops
// being read. A ceiling is a ratchet — it costs nothing while you subtract and
// fails loudly the moment the surface grows back.
//
// THE RULE (docs/superpowers/plans — the nav rule): a new capability produces a
// page kind, a page property, a saved query, or a command. It never produces a
// new top-level surface. Notion holds ~5 sidebar concepts and Linear ~6 while
// both ship features continuously; the absence of this rule is how this app
// reached 23 surfaces.
//
// When you legitimately remove surfaces or channels, LOWER these numbers in the
// same commit. Never raise them.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

/** Target is 8 (Today, Pages, Inbox, Assistant, Schedules, Graph, Obsidian, Settings). */
const MAX_SURFACES = 23;

/** No target set yet; this only ratchets downward as the surfaces go.
 *  425 unique channels across 23 surfaces is ~18 per surface — the number is
 *  here mostly so the next person can watch it fall. */
const MAX_IPC_CHANNELS = 425;

function walkTypeScript(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkTypeScript(full));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    found.push(full);
  }
  return found;
}

function uniqueIpcChannels(): string[] {
  const ipcRoot = join(ROOT, "src/main");
  const channels = new Set<string>();
  for (const file of walkTypeScript(ipcRoot)) {
    const source = readFileSync(file, "utf-8");
    const calls = source.matchAll(/safeHandle\(\s*["']([^"']+)["']/g);
    for (const match of calls) channels.add(match[1]);
  }
  return [...channels].sort();
}

function declaredSurfaces(): string[] {
  const storeTypes = join(
    ROOT,
    "src/renderer/src/screens/SpsAgent/store/storeTypes.ts",
  );
  const source = readFileSync(storeTypes, "utf-8");
  const union = /export type Surface =\s*([^;]+);/.exec(source);
  if (!union)
    throw new Error("could not find the Surface union in storeTypes.ts");
  return [...union[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("surface ceilings", () => {
  it("does not grow the top-level Surface count", () => {
    const surfaces = declaredSurfaces();

    expect(surfaces.length).toBeLessThanOrEqual(MAX_SURFACES);
  });

  it("does not grow the IPC channel count", () => {
    const channels = uniqueIpcChannels();

    expect(channels.length).toBeLessThanOrEqual(MAX_IPC_CHANNELS);
  });

  it("reads a plausible Surface union, so the ceiling cannot pass vacuously", () => {
    const surfaces = declaredSurfaces();

    expect(surfaces).toContain("doc");
    expect(surfaces.length).toBeGreaterThan(1);
  });

  it("reads plausible IPC channels, so the ceiling cannot pass vacuously", () => {
    const channels = uniqueIpcChannels();

    expect(channels.length).toBeGreaterThan(100);
  });
});

/** The sentinel that makes this file worth keeping: if a subtraction lands and
 *  nobody lowers the numbers, these tell you exactly how much slack is left. */
describe("ceiling slack (informational)", () => {
  it("reports how far the current counts sit below their ceilings", () => {
    const surfaceSlack = MAX_SURFACES - declaredSurfaces().length;
    const channelSlack = MAX_IPC_CHANNELS - uniqueIpcChannels().length;

    expect(surfaceSlack).toBeGreaterThanOrEqual(0);
    expect(channelSlack).toBeGreaterThanOrEqual(0);
  });
});
