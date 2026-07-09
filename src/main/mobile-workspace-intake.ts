import { randomBytes } from "crypto";
import { resolveSpsVaultDir } from "./sps-storage";
import { exportRowMarkdownTo } from "./sps-vault";
import { SELF_PERSON_ID } from "../shared/contacts";
import {
  frontmatterJsonLine,
  wrapFrontmatterLines,
} from "../shared/sps-frontmatter";

const TASKS_DB_FOLDER = "tasks";
const COMMAND_PREFIX_RE =
  /^\s*(?:please\s+)?(?:add\s+(?:this|that|it)?\s*(?:as\s+)?(?:a\s+)?task|create\s+(?:a\s+)?task|new\s+task)\b\s*[:-]?\s*/i;

const MOBILE_CHANNELS = new Set([
  "telegram",
  "whatsapp",
  "email",
  "macos",
  "gateway",
]);

export interface MobileWorkspaceTaskInput {
  text: string;
  channel?: string;
  chatId?: string;
  externalMessageId?: string;
  capturedAt?: number;
}

export interface MobileWorkspaceTaskResult {
  success: boolean;
  rowId?: string;
  title?: string;
  markdown?: string;
  error?: string;
}

function rowToMarkdown(props: Record<string, unknown>, body = ""): string {
  const lines = Object.keys(props)
    .filter((key) => props[key] !== undefined && props[key] !== "")
    .map((key) => frontmatterJsonLine(key, props[key]));
  return wrapFrontmatterLines(lines, body, body ? "\n\n" : "\n");
}

function normalizeChannel(channel: string | undefined): string {
  const raw = channel?.trim().toLowerCase();
  return raw && MOBILE_CHANNELS.has(raw) ? raw : "telegram";
}

function sourceForChannel(channel: string): string {
  return channel === "telegram" ? "telegram/mobile" : `${channel}/mobile`;
}

function taskTextFromMobileMessage(text: string): string {
  const trimmed = text.trim();
  const stripped = trimmed.replace(COMMAND_PREFIX_RE, "").trim();
  return stripped || trimmed;
}

function taskTitle(text: string): string {
  const firstLine = text.split(/\r?\n/)[0]?.trim() || "Mobile task";
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}...` : firstLine;
}

function taskRowId(capturedAt: number): string {
  return `mobile-task-${capturedAt.toString(36)}-${randomBytes(3).toString(
    "hex",
  )}`;
}

export async function captureMobileWorkspaceTask(
  input: MobileWorkspaceTaskInput,
  profile?: string,
): Promise<MobileWorkspaceTaskResult> {
  const normalizedText = taskTextFromMobileMessage(input.text);
  if (!normalizedText) {
    return { success: false, error: "Missing required field: text." };
  }

  const channel = normalizeChannel(input.channel);
  const capturedAt = Number.isFinite(input.capturedAt)
    ? Number(input.capturedAt)
    : Date.now();
  const capturedAtIso = new Date(capturedAt).toISOString();
  const title = taskTitle(normalizedText);
  const body = normalizedText.trim() === title ? "" : normalizedText;
  const rowId = taskRowId(capturedAt);
  const props: Record<string, unknown> = {
    title,
    status: "inbox",
    route: "human",
    source: sourceForChannel(channel),
    captureChannel: channel,
    capturedAt: capturedAtIso,
    who: SELF_PERSON_ID,
    assigneeId: SELF_PERSON_ID,
    reviewRequired: true,
  };
  if (channel === "telegram" && input.chatId?.trim()) {
    props.telegramChatId = input.chatId.trim();
  }
  if (input.externalMessageId?.trim()) {
    props.externalMessageId = input.externalMessageId.trim();
  }

  const markdown = rowToMarkdown(props, body);
  const ok = await exportRowMarkdownTo(
    resolveSpsVaultDir(profile),
    TASKS_DB_FOLDER,
    rowId,
    markdown,
  );
  if (!ok) return { success: false, error: "Could not create task row." };
  return { success: true, rowId, title, markdown };
}
