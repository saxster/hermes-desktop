// email-actions.ts — shared types + pure helpers for acting on a captured
// email (ROADMAP "Email Actions"): drafting a reply and handing it off to the
// native Mail app via a mailto: URL. Pure + dependency-free so both main and
// the renderer can use them, and vitest can cover them without Electron.

/** A reviewed reply ready for hand-off to the user's mail client. */
export interface EmailReplyDraft {
  to: string;
  subject: string;
  body: string;
}

export interface EmailDraftResult {
  ok: boolean;
  draft?: EmailReplyDraft;
  error?: string;
}

// mailto: URLs have no formal length limit, but real-world clients truncate
// long ones; keep the handed-off body well under the practical ceiling.
export const MAILTO_BODY_MAX_CHARS = 1500;

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Loose plausibility check — the value is handed to shell.openExternal. */
export function isPlausibleEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Pull the address out of a `Name <addr@host>` display string, or trim raw. */
export function extractEmailAddress(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  const candidate = (match?.[1] ?? from).trim();
  return isPlausibleEmail(candidate) ? candidate : "";
}

/** Prefix a subject with "Re: " unless it already replies. */
export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return "Re: (no subject)";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

/**
 * Build the mailto: hand-off URL from a reviewed draft, or null when the
 * recipient is not a plausible address. The body is capped for URL safety;
 * the UI always shows the full text so nothing is silently lost (Copy has it).
 */
export function buildMailtoUrl(draft: EmailReplyDraft): string | null {
  const to = extractEmailAddress(draft.to) || draft.to.trim();
  if (!isPlausibleEmail(to)) return null;
  const body =
    draft.body.length > MAILTO_BODY_MAX_CHARS
      ? `${draft.body.slice(0, MAILTO_BODY_MAX_CHARS - 1)}…`
      : draft.body;
  const query = `subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${encodeURIComponent(to)}?${query}`;
}
