import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseJsonScalarFrontmatter,
  splitSpsFrontmatter,
} from "../src/shared/sps-frontmatter";

const mocks = vi.hoisted(() => ({
  exportRowMarkdownTo: vi.fn(),
  resolveSpsVaultDir: vi.fn(),
}));

vi.mock("../src/main/sps-storage", () => ({
  resolveSpsVaultDir: mocks.resolveSpsVaultDir,
}));

vi.mock("../src/main/sps-vault", () => ({
  exportRowMarkdownTo: mocks.exportRowMarkdownTo,
}));

import { captureMobileWorkspaceTask } from "../src/main/mobile-workspace-intake";

function parseRow(markdown: string): {
  props: Record<string, unknown>;
  body: string;
} {
  const { frontmatter, body } = splitSpsFrontmatter(markdown);
  return {
    props: parseJsonScalarFrontmatter(frontmatter ?? ""),
    body,
  };
}

describe("captureMobileWorkspaceTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSpsVaultDir.mockReturnValue("/vault");
    mocks.exportRowMarkdownTo.mockResolvedValue(true);
  });

  it("writes Telegram task captures as review-first human SPS task rows", async () => {
    const capturedAt = Date.UTC(2026, 6, 7, 7, 0, 0);
    const result = await captureMobileWorkspaceTask(
      {
        text: "add this as a task: Check Friday guard roster",
        channel: "telegram",
        chatId: " 12345 ",
        externalMessageId: " msg-1 ",
        capturedAt,
      },
      "owner",
    );

    expect(result.success).toBe(true);
    expect(result.rowId).toMatch(/^mobile-task-/);
    expect(mocks.resolveSpsVaultDir).toHaveBeenCalledWith("owner");
    expect(mocks.exportRowMarkdownTo).toHaveBeenCalledWith(
      "/vault",
      "tasks",
      result.rowId,
      expect.any(String),
    );

    const markdown = String(mocks.exportRowMarkdownTo.mock.calls[0][3]);
    const row = parseRow(markdown);
    expect(row.props).toMatchObject({
      title: "Check Friday guard roster",
      status: "inbox",
      route: "human",
      source: "telegram/mobile",
      captureChannel: "telegram",
      capturedAt: "2026-07-07T07:00:00.000Z",
      who: "you",
      assigneeId: "you",
      reviewRequired: true,
      telegramChatId: "12345",
      externalMessageId: "msg-1",
    });
    expect(row.props).not.toHaveProperty("context");
    expect(row.body).toBe("");
  });

  it("keeps multi-line phone details in the task body", async () => {
    await captureMobileWorkspaceTask({
      text: "new task\nConfirm the north gate list\nNeeds Raj approval",
      capturedAt: Date.UTC(2026, 6, 7, 8, 30, 0),
    });

    const markdown = String(mocks.exportRowMarkdownTo.mock.calls[0][3]);
    const row = parseRow(markdown);
    expect(row.props.title).toBe("Confirm the north gate list");
    expect(row.body.trim()).toBe(
      "Confirm the north gate list\nNeeds Raj approval",
    );
  });

  it("rejects empty mobile messages before writing", async () => {
    const result = await captureMobileWorkspaceTask({ text: "  " });

    expect(result).toEqual({
      success: false,
      error: "Missing required field: text.",
    });
    expect(mocks.exportRowMarkdownTo).not.toHaveBeenCalled();
  });
});
