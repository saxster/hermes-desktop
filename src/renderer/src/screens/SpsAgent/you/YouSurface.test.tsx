import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouSurface } from "./YouSurface";
import {
  discoverMemoryProviders,
  getMemoryTimeline,
  listLearningProposals,
  readFocus,
  readMemory,
  writeUserProfile,
} from "../../../lib/api/memory";

vi.mock("../../../lib/api/memory", () => ({
  addMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  discoverMemoryProviders: vi.fn(),
  getMemoryTimeline: vi.fn(),
  listLearningProposals: vi.fn(),
  readFocus: vi.fn(),
  readMemory: vi.fn(),
  removeMemoryEntry: vi.fn().mockResolvedValue(true),
  updateMemoryEntry: vi.fn().mockResolvedValue({ success: true }),
  writeFocus: vi.fn().mockResolvedValue({ success: true }),
  writeMemory: vi.fn().mockResolvedValue({ success: true }),
  writeUserProfile: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("./SoulEditor", () => ({
  SoulEditor: () => <div>Custom persona editor</div>,
}));

vi.mock("./MemoryProviders", () => ({
  MemoryProviders: () => <div>External provider cards</div>,
}));

describe("YouSurface", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(readMemory).mockResolvedValue({
      memory: {
        content: "Prefers concise answers.",
        entries: [{ index: 0, content: "Prefers concise answers." }],
        charCount: 24,
        charLimit: 2200,
        exists: true,
        lastModified: null,
      },
      user: {
        content: "Works on local-first products.",
        charCount: 30,
        charLimit: 2200,
        exists: true,
        lastModified: null,
      },
      stats: { totalSessions: 1, totalMessages: 2 },
    });
    vi.mocked(readFocus).mockResolvedValue("Settings simplification");
    vi.mocked(listLearningProposals).mockResolvedValue([
      {
        id: "proposal-1",
        kind: "memory",
        body: "Likes concise UI",
        reason: "Observed preference",
        createdAt: 1_785_000_000,
        updatedAt: 1_785_000_000,
        source: { type: "session", id: "session-1" },
        status: "pending",
      },
    ]);
    vi.mocked(discoverMemoryProviders).mockResolvedValue([
      {
        name: "mem0",
        description: "memory.mem0",
        installed: true,
        active: false,
        envVars: ["MEM0_API_KEY"],
      },
    ]);
    vi.mocked(getMemoryTimeline).mockResolvedValue({
      entries: [{ index: 0, content: "Prefers concise answers." }],
    });

    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        getConfig: vi.fn().mockResolvedValue(""),
        getDailyContextHookStatus: vi.fn().mockResolvedValue({
          configured: true,
          allowlisted: true,
          scriptExists: true,
          enabled: true,
        }),
        setDailyContextHookEnabled: vi
          .fn()
          .mockResolvedValue({ success: true }),
        runTelosAudit: vi.fn().mockResolvedValue({ success: false }),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { hermesAPI?: unknown }).hermesAPI;
  });

  it("keeps ordinary personalization in three progressive-disclosure views", async () => {
    render(<YouSurface profile="default" />);

    await screen.findByRole("tab", { name: "How to work with me" });
    expect(screen.getByText("Response style")).toBeTruthy();
    expect(screen.queryByText("External provider cards")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /What you remember/ }));
    expect(await screen.findByText("1 suggested memory")).toBeTruthy();
    expect(
      screen.getAllByText("Prefers concise answers.").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Edit MEMORY.md source")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByText("Built-in memory")).toBeTruthy();
    expect(screen.queryByText("External provider cards")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Change memory backend…" }),
    );
    expect(screen.getByText("External provider cards")).toBeTruthy();
  });

  it("turns a response-style preset into an editable standing rule", async () => {
    render(<YouSurface profile="default" />);
    const direct = await screen.findByRole("button", { name: /Direct/ });
    fireEvent.click(direct);

    await waitFor(() => expect(writeUserProfile).toHaveBeenCalled());
    expect(vi.mocked(writeUserProfile).mock.calls[0]?.[0]).toContain(
      "Lead with the answer",
    );
  });
});
