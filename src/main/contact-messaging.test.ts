import { beforeEach, describe, expect, it, vi } from "vitest";

const { readRow, writeRow, setNag, removeNag } = vi.hoisted(() => ({
  readRow: vi.fn(),
  writeRow: vi.fn(),
  setNag: vi.fn(),
  removeNag: vi.fn(),
}));

vi.mock("electron", () => ({ shell: { openExternal: vi.fn() } }));
vi.mock("./sps-storage", () => ({ resolveSpsVaultDir: () => "/vault" }));
vi.mock("./sps-vault", () => ({
  readRowMarkdownFrom: readRow,
  exportRowMarkdownTo: writeRow,
}));
vi.mock("./tasks-dump", () => ({
  setNagRecord: setNag,
  removeNagRecord: removeNag,
}));

import { buildHandoffUrl, openContactChannel } from "./contact-messaging";
import { shell } from "electron";
import type { ContactChannel } from "../shared/contacts";

const ch = (kind: ContactChannel["kind"], value: string): ContactChannel => ({
  kind,
  value,
});

describe("buildHandoffUrl", () => {
  it("builds mailto / sms / imessage / wa.me schemes", () => {
    expect(buildHandoffUrl(ch("email", "p@x.com"))).toBe("mailto:p@x.com");
    expect(buildHandoffUrl(ch("sms", "+91 98 765"))).toBe("sms:+9198765");
    expect(buildHandoffUrl(ch("imessage", "+91-98-765"))).toBe(
      "imessage:+9198765",
    );
    expect(buildHandoffUrl(ch("whatsapp", "+91 98765 43210"))).toBe(
      "https://wa.me/919876543210",
    );
  });

  it("returns null for telegram (auto-send only) and empty values", () => {
    expect(buildHandoffUrl(ch("telegram", "12345"))).toBeNull();
    expect(buildHandoffUrl(ch("email", "   "))).toBeNull();
  });
});

describe("openContactChannel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readRow.mockResolvedValue(
      '---\ntitle: "Priya"\nschema: "person"\n---\nExisting notes',
    );
    writeRow.mockResolvedValue(true);
    setNag.mockResolvedValue(undefined);
  });

  it("opens a handoff URL and reports success", async () => {
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    const ok = await openContactChannel(ch("email", "p@x.com"));
    expect(ok).toBe(true);
    expect(shell.openExternal).toHaveBeenCalledWith("mailto:p@x.com");
  });

  it("does nothing for a channel with no OS handoff", async () => {
    vi.mocked(shell.openExternal).mockClear();
    const ok = await openContactChannel(ch("telegram", "12345"));
    expect(ok).toBe(false);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("logs outreach on the contact and creates a follow-up nag", async () => {
    vi.mocked(shell.openExternal).mockResolvedValue(undefined);
    const now = Date.now();

    const ok = await openContactChannel(ch("email", "p@x.com"), {
      personId: "priya",
      personName: "Priya",
      followUpAt: now + 86_400_000,
    });

    expect(ok).toBe(true);
    expect(writeRow).toHaveBeenCalledWith(
      "/vault",
      "people",
      "priya",
      expect.stringContaining("lastOutreachChannel: email"),
    );
    expect(setNag).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "followup:priya",
        nextNagAt: expect.any(Number),
        cadence: "daily",
      }),
      undefined,
    );
  });
});
