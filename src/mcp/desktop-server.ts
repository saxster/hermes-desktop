import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Discover control server details
function getControlServerConfig(): { port: number; token: string } {
  const desktopJsonPath = join(homedir(), ".hermes", "desktop.json");
  if (!existsSync(desktopJsonPath)) {
    throw new Error(`Hermes config file not found at ${desktopJsonPath}`);
  }
  try {
    const config = JSON.parse(readFileSync(desktopJsonPath, "utf-8"));
    const port = config.controlServerPort;
    const token = config.controlServerToken;
    if (!port || !token) {
      throw new Error(
        "Missing controlServerPort or controlServerToken in desktop.json",
      );
    }
    return { port: Number(port), token: String(token) };
  } catch (err) {
    throw new Error(
      `Failed to parse Hermes config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

const server = new Server(
  { name: "desktop", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

/**
 * POST a JSON body to the desktop control server and return its parsed reply.
 *
 * Every tool below is a thin proxy over one control-server endpoint, so the
 * config lookup, bearer auth, and status handling live here once.
 */
async function postControl(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { port, token } = getControlServerConfig();
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Control server returned status ${response.status}: ${errText}`,
    );
  }

  return (await response.json()) as Record<string, unknown>;
}

const TOOLS = [
  {
    name: "create_cron_job",
    description:
      "Create a scheduled automation / cron task in Hermes to run code or prompts on a regular interval. " +
      "Takes a standard cron expression or schedule and registers a job on the local control server.",
    inputSchema: {
      type: "object",
      properties: {
        schedule: {
          type: "string",
          description:
            "Cron schedule expression (e.g. '0 9 * * 1' for every Monday at 9 AM) or interval.",
        },
        prompt: {
          type: "string",
          description:
            "The prompt or message for the LLM advisor to run when the schedule triggers.",
        },
        name: {
          type: "string",
          description:
            "Human-readable name for the cron job (e.g. 'Audit weekly ticker XYZ').",
        },
        deliver: {
          type: "string",
          description:
            "Target location/channel to deliver results (e.g. a specific note page ID, or 'chat').",
        },
      },
      required: ["schedule", "prompt", "name"],
    },
  },
  {
    name: "build_context_pack",
    description:
      "Build a deterministic Markdown context pack from the local SPS/Obsidian vault for another AI agent. " +
      "Includes the selected note, backlinks, linked sources, related tasks, unresolved questions, and provenance.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "SPS page id or Markdown path to package.",
        },
        maxBytes: {
          type: "number",
          description: "Maximum UTF-8 bytes in the returned pack.",
        },
        save: {
          type: "boolean",
          description:
            "When true, also save the pack under vault/_context-packs/.",
        },
      },
      required: ["pageId"],
    },
  },
  {
    name: "sps_write_page",
    description:
      "Write a Markdown page into the owner's SPS workspace vault, creating it or replacing it in full. " +
      "This is how you put work in front of the owner: briefs, research write-ups, digests and summaries " +
      "become pages they can read, search, link and edit. Prefer this over returning a long response that " +
      "is only delivered once. Include YAML frontmatter with at least a `title` when you want a readable name.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description:
            "Vault page id, also the filename stem. Letters, digits, underscore and hyphen only — " +
            "no spaces, dots or slashes (e.g. 'daily-brief-2026-07-25'). Reusing an id overwrites that page.",
        },
        markdown: {
          type: "string",
          description:
            "Full Markdown body of the page, optionally starting with a YAML frontmatter block.",
        },
      },
      required: ["pageId", "markdown"],
    },
  },
  {
    name: "sps_write_capture",
    description:
      "Drop a note into the owner's SPS capture inbox for later triage. " +
      "Use for something worth the owner's attention that is not yet a finished page — a link, a finding, " +
      "a passing observation. Use sps_write_page instead when the content is a finished document.",
    inputSchema: {
      type: "object",
      properties: {
        body: {
          type: "string",
          description: "Capture body text (required).",
        },
        title: { type: "string", description: "Short title for the capture." },
        description: {
          type: "string",
          description: "One-line summary shown in the triage list.",
        },
        url: {
          type: "string",
          description: "Source URL, when the capture came from the web.",
        },
        source: {
          type: "string",
          enum: ["quick-note", "web"],
          description: "Capture origin. Defaults to 'quick-note'.",
        },
      },
      required: ["body"],
    },
  },
  {
    name: "sps_create_task",
    description:
      "Add a task row to a database folder in the owner's SPS vault. " +
      "Use when a run produces something the owner must actually do, so it lands in their task list " +
      "rather than only in prose.",
    inputSchema: {
      type: "object",
      properties: {
        markdown: {
          type: "string",
          description:
            "Task row Markdown, normally frontmatter (title, status, due) plus an optional body.",
        },
        dbFolder: {
          type: "string",
          description: "Vault database folder. Defaults to 'tasks'.",
        },
        rowId: {
          type: "string",
          description:
            "Stable row id for idempotent updates. Defaults to a timestamped id.",
        },
      },
      required: ["markdown"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, unknown>;

  try {
    if (name === "create_cron_job") {
      const payload = await postControl("/cron/create", {
        schedule: a.schedule,
        prompt: a.prompt,
        name: a.name,
        deliver: a.deliver,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    } else if (name === "build_context_pack") {
      const payload = await postControl("/sps/context-pack", {
        pageId: a.pageId,
        maxBytes: a.maxBytes,
        save: a.save,
      });
      return {
        content: [
          {
            type: "text",
            text:
              typeof payload.markdown === "string"
                ? payload.markdown
                : JSON.stringify(payload, null, 2),
          },
        ],
      };
    } else if (name === "sps_write_page") {
      const payload = await postControl("/sps/page", {
        pageId: a.pageId,
        markdown: a.markdown,
      });
      // The endpoint answers 200 with success:false when the page id fails
      // validation, so surface that as a tool error rather than a silent no-op.
      if (payload.success !== true) {
        throw new Error(
          `Vault refused the write. Page ids allow only letters, digits, underscore and hyphen; got "${String(a.pageId)}".`,
        );
      }
      return {
        content: [
          { type: "text", text: `Wrote vault page "${String(a.pageId)}".` },
        ],
      };
    } else if (name === "sps_write_capture") {
      const payload = await postControl("/sps/capture", {
        body: a.body,
        title: a.title,
        description: a.description,
        url: a.url,
        source: a.source === "web" ? "web" : "quick-note",
        via: "desktop-mcp",
      });
      if (payload.success !== true) {
        throw new Error(`Capture was not written: ${JSON.stringify(payload)}`);
      }
      return {
        content: [{ type: "text", text: "Added a capture to the SPS inbox." }],
      };
    } else if (name === "sps_create_task") {
      const payload = await postControl("/sps/task", {
        markdown: a.markdown,
        dbFolder: a.dbFolder,
        rowId: a.rowId,
      });
      if (payload.success !== true) {
        throw new Error(`Task row was not written: ${JSON.stringify(payload)}`);
      }
      return {
        content: [
          {
            type: "text",
            text: `Created task row "${String(payload.rowId ?? a.rowId ?? "")}".`,
          },
        ],
      };
    } else {
      throw new Error(`unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Desktop MCP error: ${message}` }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(
    "Desktop MCP server failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
