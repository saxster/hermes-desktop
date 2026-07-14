import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chatCompletionOnce: vi.fn(),
  rebuild: vi.fn(),
  safeWriteFileAsync: vi.fn(),
}));

vi.mock("./hermes/chat-client", () => ({
  chatCompletionOnce: mocks.chatCompletionOnce,
}));

vi.mock("./note-index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./note-index")>();
  return {
    ...actual,
    getSpsNoteIndex: vi.fn(async () => ({
      query: () => [{ title: "Alpha", path: "alpha.md" }],
      lint: () => ({ brokenLinks: [], orphans: [] }),
      rebuild: mocks.rebuild,
    })),
  };
});

vi.mock("./utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./utils")>();
  return {
    ...actual,
    safeWriteFileAsync: mocks.safeWriteFileAsync,
  };
});

let home: string;
let vault: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HERMES_HOME;
  home = mkdtempSync(join(tmpdir(), "dream-cycle-test-"));
  vault = join(home, "sps-agent", "vault");
  mkdirSync(vault, { recursive: true });
  writeFileSync(join(vault, "alpha.md"), "# Alpha\n\nBody", "utf-8");
  process.env.HERMES_HOME = home;
  mocks.chatCompletionOnce.mockReset();
  mocks.rebuild.mockReset();
  mocks.safeWriteFileAsync.mockReset();
  mocks.safeWriteFileAsync.mockImplementation((file, content) =>
    writeFile(file, content, "utf-8"),
  );
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

describe("Dream Cycle durability", () => {
  it("skips a concurrent run while the profile lock is held", async () => {
    let releaseSummary!: () => void;
    const summaryGate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    mocks.chatCompletionOnce
      .mockImplementationOnce(async () => {
        await summaryGate;
        return { content: "Alpha summary", error: null };
      })
      .mockResolvedValue({ content: "# Daily Brief", error: null });
    const { runDreamCycle } = await import("./dream-cycle");

    const first = runDreamCycle("default");
    await vi.waitFor(() => expect(mocks.chatCompletionOnce).toHaveBeenCalled());
    await runDreamCycle("default");
    const callsBeforeRelease = mocks.chatCompletionOnce.mock.calls.length;
    releaseSummary();
    await first;

    expect(callsBeforeRelease).toBe(1);
    expect(mocks.chatCompletionOnce).toHaveBeenCalledTimes(2);
    expect(existsSync(join(home, "locks", "dream-cycle.lock"))).toBe(false);
  });

  it("atomically commits both note summaries and the generated brief", async () => {
    mocks.chatCompletionOnce
      .mockResolvedValueOnce({ content: "Alpha summary", error: null })
      .mockResolvedValueOnce({ content: "# Daily Brief", error: null });
    const { runDreamCycle } = await import("./dream-cycle");

    await runDreamCycle("default");

    expect(mocks.safeWriteFileAsync).toHaveBeenCalledTimes(2);
    expect(mocks.safeWriteFileAsync).toHaveBeenCalledWith(
      join(vault, "alpha.md"),
      expect.stringContaining("summary: Alpha summary"),
    );
    expect(mocks.safeWriteFileAsync).toHaveBeenCalledWith(
      expect.stringContaining("Daily Brief - "),
      expect.stringContaining("# Daily Brief"),
    );
  });
});
