export type McpTransport = "http" | "stdio" | "unknown";

export interface ParsedMcpServer {
  name: string;
  type: McpTransport;
  transport: McpTransport;
  enabled: boolean;
  detail: string;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
  tools?: unknown;
}

export interface McpBlock {
  startLine: number;
  endLine: number;
  lines: string[];
}

export interface McpServerBlock {
  name: string;
  lines: string[];
  startOffset: number;
}

function parseYamlScalar(raw: string): string {
  let value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"')) {
    let out = "";
    for (let i = 1; i < value.length; i++) {
      const ch = value[i];
      if (ch === "\\" && i + 1 < value.length) {
        out += value[i + 1];
        i += 1;
        continue;
      }
      if (ch === '"') return out;
      out += ch;
    }
    return out;
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end >= 0 ? value.slice(1, end) : value.slice(1);
  }
  const commentIdx = value.search(/\s+#/);
  if (commentIdx >= 0) value = value.slice(0, commentIdx);
  return value.trim();
}

function parseInlineList(raw: string): string[] {
  const value = raw.trim();
  if (!value.startsWith("[") || !value.endsWith("]")) return [];
  const body = value.slice(1, -1).trim();
  if (!body) return [];
  const items: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const ch of body) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote && ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ",") {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  items.push(current.trim());
  return items.filter(Boolean);
}

export function findMcpBlock(content: string): McpBlock | null {
  const lines = content.split(/\r?\n/);
  const startLine = lines.findIndex((line) =>
    /^mcp_servers\s*:\s*(?:#.*)?$/.test(line.trimEnd()),
  );
  if (startLine < 0) return null;

  let endLine = lines.length;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^\S[^:]*:/.test(line)) {
      endLine = i;
      break;
    }
  }

  return {
    startLine,
    endLine,
    lines: lines.slice(startLine, endLine),
  };
}

export function mcpServerBlocks(lines: string[]): McpServerBlock[] {
  const blocks: McpServerBlock[] = [];
  let current: McpServerBlock | null = null;

  const pushCurrent = (): void => {
    if (!current) return;
    while (
      current.lines.length > 1 &&
      current.lines[current.lines.length - 1].trim() === ""
    ) {
      current.lines.pop();
    }
    blocks.push(current);
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(
      /^ {2}([A-Za-z0-9][A-Za-z0-9_-]*)\s*:\s*(?:#.*)?$/,
    );
    if (match) {
      pushCurrent();
      current = { name: match[1], lines: [line], startOffset: i };
      continue;
    }
    if (current) current.lines.push(line);
  }

  pushCurrent();
  return blocks;
}

function parseServerBlock(lines: string[]): Omit<ParsedMcpServer, "name" | "type" | "transport" | "detail"> {
  const result: Omit<
    ParsedMcpServer,
    "name" | "type" | "transport" | "detail"
  > = { args: [], env: {}, enabled: true };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const scalar = line.match(/^ {4}([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!scalar) continue;
    const key = scalar[1];
    const raw = scalar[2] || "";

    if (key === "url") result.url = parseYamlScalar(raw);
    else if (key === "command") result.command = parseYamlScalar(raw);
    else if (key === "auth") result.auth = parseYamlScalar(raw);
    else if (key === "enabled") {
      result.enabled = raw.trim().toLowerCase() !== "false";
    } else if (key === "args") {
      if (raw.trim().startsWith("[")) {
        result.args = parseInlineList(raw);
      } else {
        const args: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const item = lines[j].match(/^ {6}-\s*(.*)$/);
          if (!item) break;
          args.push(parseYamlScalar(item[1]));
          i = j;
        }
        result.args = args;
      }
    } else if (key === "env" && !raw.trim()) {
      const env: Record<string, string> = {};
      for (let j = i + 1; j < lines.length; j++) {
        const item = lines[j].match(
          /^ {6}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/,
        );
        if (!item) break;
        env[item[1]] = parseYamlScalar(item[2]);
        i = j;
      }
      result.env = env;
    } else if (key === "tools") {
      result.tools = raw.trim() ? parseYamlScalar(raw) : {};
    }
  }

  return result;
}

export function parseMcpServersFromConfig(
  content: string,
): ParsedMcpServer[] {
  const block = findMcpBlock(content);
  if (!block) return [];

  return mcpServerBlocks(block.lines).map(({ name, lines }) => {
    const config = parseServerBlock(lines);
    const type: McpTransport = config.url
      ? "http"
      : config.command
        ? "stdio"
        : "unknown";
    return {
      ...config,
      name,
      type,
      transport: type,
      enabled: config.enabled !== false,
      detail: config.url || config.command || "",
    };
  });
}
