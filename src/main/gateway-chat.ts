// gateway-chat.ts — a light, shared wrapper for one-shot LLM calls against the
// Hermes gateway (OpenAI-compatible /v1/chat/completions). Extracted so new
// features (task triage, contact enrichment) reuse one proven implementation
// instead of re-pasting the fetch+parse dance. Kept dependency-light on
// purpose: the older private copies in scheduled-research.ts/sps-agent.ts
// duplicated this only to avoid a heavy import — new code should import here.
import { getApiUrl, getGatewayAuthHeader } from "./hermes";
import { gatewayFetch } from "./security/network-policy";

const GATEWAY_TIMEOUT_MS = 240_000;

export interface ChatMessage {
  role: string;
  content: string;
}

/** One non-streaming chat completion. Returns the message text (or ""). */
export async function gatewayChat(
  messages: ChatMessage[],
  maxTokens: number,
  profile?: string,
): Promise<string> {
  const url = `${getApiUrl(profile)}/v1/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Profile-scoped: getRemoteAuthHeader() would resolve the DEFAULT
    // profile's api_server_key even when this call targets another profile.
    ...getGatewayAuthHeader(profile),
  };
  const res = await gatewayFetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    body: JSON.stringify({
      model: "hermes-agent",
      stream: false,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${body.slice(0, 160)}`);
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
