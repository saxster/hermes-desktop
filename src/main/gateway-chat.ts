// gateway-chat.ts — THE shared wrapper for one-shot LLM calls against the
// Hermes gateway (OpenAI-compatible /v1/chat/completions). Every non-streaming
// completion in the main process goes through here; the twelve private copies
// that used to re-paste the fetch+parse dance (sps-agent, scheduler,
// telos-auditor, deck-studio, skills) now call this. Streaming and the
// tool/approval chat loop live in hermes/chat-client/ — this is the one-shot
// lane only, kept dependency-light on purpose.
import { log } from "./log";
import { getApiUrl, getGatewayAuthHeader } from "./hermes";
import { gatewayFetch } from "./security/network-policy";

const GATEWAY_TIMEOUT_MS = 240_000;

/** OpenAI content parts — used by the vision calls (self-healing screenshots). */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: string;
  /** Plain text, or content parts when the call carries an image. */
  content: string | ChatContentPart[];
}

export interface GatewayChatOptions {
  /** Request timeout. Defaults to GATEWAY_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Log scope, used only when the error body cannot be read. */
  scope?: string;
}

/**
 * A non-2xx response from the gateway. Carries the status so callers can tell
 * a 4xx (auth/client error — never retry) from a 5xx (worth one retry); the
 * private copies each re-derived that distinction from a raw Response.
 */
export class GatewayChatError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`gateway ${status}: ${body.slice(0, 160)}`);
    this.name = "GatewayChatError";
    this.status = status;
    this.body = body;
  }
}

/** Best-effort error body. A body we cannot read must not mask the status. */
async function readErrorBody(res: Response, scope?: string): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    log.warn("gateway-chat.error-body", {
      scope: scope ?? "gateway-chat",
      status: res.status,
      error: err instanceof Error ? err.message : String(err),
    });
    return "";
  }
}

/**
 * One non-streaming chat completion. Returns the message text (or "").
 * Throws `GatewayChatError` on a non-2xx response.
 *
 * `maxTokens` is `null` when the caller wants no cap — the field is then
 * omitted from the request and the model's own default applies. Passing a
 * number where the old private copy omitted one would silently truncate.
 */
export async function gatewayChat(
  messages: ChatMessage[],
  maxTokens: number | null,
  profile?: string,
  options?: GatewayChatOptions,
): Promise<string> {
  const url = `${getApiUrl(profile)}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Profile-scoped: getRemoteAuthHeader() would resolve the DEFAULT
    // profile's api_server_key even when this call targets another profile.
    ...getGatewayAuthHeader(profile),
  };
  const payload: Record<string, unknown> = {
    model: "hermes-agent",
    stream: false,
    messages,
  };
  if (maxTokens !== null) payload.max_tokens = maxTokens;
  const timeoutMs = options?.timeoutMs ?? GATEWAY_TIMEOUT_MS;
  const res = await gatewayFetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await readErrorBody(res, options?.scope);
    throw new GatewayChatError(res.status, body);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data?.choices?.[0]?.message?.content ?? "";
}

/** Best-effort JSON extractor: strips ```json fences, then slices the outer
 *  object/array. Returns null when nothing parseable is found. */
export function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}
