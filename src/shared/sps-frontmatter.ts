import YAML from "yaml";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitSpsFrontmatter(markdown: string): {
  frontmatter: string | null;
  body: string;
} {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return { frontmatter: null, body: markdown };
  return { frontmatter: match[1], body: markdown.slice(match[0].length) };
}

export function frontmatterJsonLine(key: string, value: unknown): string {
  return `${key}: ${JSON.stringify(value)}`;
}

export function wrapFrontmatterLines(
  lines: string[],
  body: string,
  afterMarker = "\n\n",
): string {
  if (lines.length === 0) return body;
  return `---\n${lines.join("\n")}\n---${afterMarker}${body}`;
}

// SPS emits JSON-style scalars, which are valid YAML. Parse the complete YAML
// mapping so externally-authored block sequences and block scalars survive too.
export function parseJsonScalarFrontmatter(
  frontmatter: string,
): Record<string, unknown> {
  try {
    const parsed = YAML.parse(frontmatter);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the tolerant legacy line parser for malformed files.
  }

  const props: Record<string, unknown> = {};
  for (const line of frontmatter.split("\n")) {
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim();
    const rawValue = line.slice(sep + 1).trim();
    try {
      props[key] = JSON.parse(rawValue);
    } catch {
      props[key] = rawValue;
    }
  }
  return props;
}

export function parseYamlFrontmatterMarkdown(markdown: string): {
  props: Record<string, unknown>;
  body: string;
} {
  const { frontmatter, body } = splitSpsFrontmatter(markdown);
  if (frontmatter === null) return { props: {}, body };
  try {
    const parsed = YAML.parse(frontmatter);
    const props =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return { props, body };
  } catch {
    return { props: {}, body };
  }
}

export function stringifySortedYamlFrontmatter(
  props: Record<string, unknown>,
  body: string,
): string {
  const keys = Object.keys(props).filter((key) => props[key] !== undefined);
  if (keys.length === 0) return body;
  const sorted: Record<string, unknown> = {};
  for (const key of keys.sort()) sorted[key] = props[key];
  return `---\n${YAML.stringify(sorted).trim()}\n---\n${
    body.startsWith("\n") ? body.slice(1) : body
  }`;
}
