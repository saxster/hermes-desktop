import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { localDateKey } from "./utils";

const DAILY_BRIEF_RE = /^Daily Brief - \d{4}-\d{2}-\d{2}\.md$/;
const MAX_DAILY_BRIEF_CONTEXT_CHARS = 1200;

export function dailyBriefFileName(date: Date): string {
  return `Daily Brief - ${localDateKey(date)}.md`;
}

const LEADING_FRONTMATTER_RE =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Drop a frontmatter block the model emitted itself.
 *
 * The Dream Cycle report prompt names `context: review`, so the model routinely
 * opens its response with its own `---` block. `buildDailyBriefMarkdown` then
 * wrapped that in a second one, so the file body started with `---`. Every
 * strict frontmatter parser — including `extractOptedInDailyBrief` below, which
 * reads only the outer block — then sees the wrong keys, which is why the
 * opt-into-context flag could never take effect. Observed 2026-07-25 in
 * `~/.hermes/sps-agent/vault/Daily Brief - 2026-07-25.md`.
 *
 * A leading `---` that is a horizontal rule rather than frontmatter is left
 * alone: the block must contain at least one `key:` line to be stripped.
 */
export function stripLeadingFrontmatter(markdown: string): string {
  const match = markdown.match(LEADING_FRONTMATTER_RE);
  if (!match) return markdown;
  const block = match[1] ?? "";
  const looksLikeYaml = /^[A-Za-z][\w-]*[ \t]*:/m.test(block);
  if (!looksLikeYaml) return markdown;
  return markdown.slice(match[0].length);
}

export function buildDailyBriefMarkdown(input: {
  date: Date;
  body: string;
}): string {
  const day = localDateKey(input.date);
  const title = `Daily Brief - ${day}`;
  const modelBody = stripLeadingFrontmatter(input.body.trim()).trim();
  const body = modelBody || `# ${title}\n\nNo brief generated.`;
  return `---\ntitle: "${title}"\nkind: daily-brief\ncontext: review\n---\n${body}\n`;
}

export function extractOptedInDailyBrief(markdown: string): string {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return "";
  const frontmatter = match[1] ?? "";
  if (!/^context:\s*include\s*$/im.test(frontmatter)) return "";
  const body = (match[2] ?? "").trim();
  if (!body) return "";
  return body.length <= MAX_DAILY_BRIEF_CONTEXT_CHARS
    ? body
    : `${body.slice(0, MAX_DAILY_BRIEF_CONTEXT_CHARS).trimEnd()}\n...`;
}

export function readLatestOptedInDailyBrief(vaultDir: string): string {
  try {
    if (!existsSync(vaultDir)) return "";
    const names = readdirSync(vaultDir)
      .filter((name) => DAILY_BRIEF_RE.test(name))
      .sort()
      .reverse();
    for (const name of names) {
      const text = extractOptedInDailyBrief(
        readFileSync(join(vaultDir, name), "utf-8"),
      );
      if (text) return text;
    }
  } catch {
    return "";
  }
  return "";
}
