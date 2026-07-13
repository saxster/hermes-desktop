// control-server.ts — the localhost control/automation HTTP server.
//
// NOTE(deferred): this file multiplexes ~13 endpoints (control, calendar feed,
// captures, context packs…) behind one router. That is a structural
// observation, not a bug — splitting into per-domain routers is a separate,
// larger change (audit 2026-07-06, LOW/A4).
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "crypto";
import { timingSafeTokenEqual } from "./security";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
  unlinkSync,
  copyFileSync,
  renameSync,
} from "fs";
import { homedir } from "os";
import { join, basename } from "path";
import { getActiveProfileNameSync, safeWriteFile } from "./utils";
import {
  HERMES_HOME,
  getBundledScriptPath,
  getHermesHome,
} from "./installer/paths";
import {
  readDesktopConfig,
  writeDesktopConfig,
  getConnectionConfig,
} from "./config";
import { isGatewayRunning, sendMessage } from "./hermes";
import { runJobHeadless, tickScheduler } from "./scheduler";
import { execFile } from "child_process";
import { createCronJob } from "./cronjobs";
import { getSpsNoteIndex } from "./note-index";
import { resolveSpsVaultDir } from "./sps-storage";
import { writeSpsCapture } from "./sps-capture";
import { formatLogError, log } from "./log";
import {
  exportPageMarkdownTo,
  exportRowMarkdownTo,
  readPageMarkdownFrom,
} from "./sps-vault";
import { buildContextPack } from "./context-packs";
import { getProfilePort } from "./gateway-ports";

let serverInstance: ReturnType<typeof createServer> | null = null;
let currentPort = 8645;
let authToken = "";
let calendarFeedToken = "";

function handleAsyncRequestFailure(
  res: ServerResponse,
  route: string,
  error: unknown,
): void {
  log.error("control-server", {
    msg: "async request handler failed",
    route,
    error: formatLogError(error),
  });
  if (!res.writableEnded) {
    writeJson(res, 500, { error: "Internal server error." });
  }
}

/**
 * Generate a secure token if one is not already present, and store it in desktop.json.
 */
function ensureAuthToken(): string {
  const config = readDesktopConfig();
  if (
    typeof config.controlServerToken === "string" &&
    config.controlServerToken
  ) {
    authToken = config.controlServerToken;
    return authToken;
  }

  authToken = randomBytes(32).toString("hex");
  config.controlServerToken = authToken;
  writeDesktopConfig(config);
  return authToken;
}

function ensureCalendarFeedToken(): string {
  const config = readDesktopConfig();
  if (
    typeof config.calendarFeedToken === "string" &&
    config.calendarFeedToken
  ) {
    calendarFeedToken = config.calendarFeedToken;
    return calendarFeedToken;
  }

  calendarFeedToken = randomBytes(32).toString("hex");
  config.calendarFeedToken = calendarFeedToken;
  writeDesktopConfig(config);
  return calendarFeedToken;
}

function hasBearerControlToken(req: IncomingMessage): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
  return timingSafeTokenEqual(authHeader.substring(7).trim(), authToken);
}

function isCalendarAuthorized(req: IncomingMessage, url: URL): boolean {
  if (hasBearerControlToken(req)) return true;
  if (
    timingSafeTokenEqual(url.searchParams.get("feedToken"), calendarFeedToken)
  )
    return true;
  // Compatibility for existing calendar subscriptions. Keep this calendar-only:
  // general control endpoints still require the Authorization header below.
  return timingSafeTokenEqual(url.searchParams.get("token"), authToken);
}

function getICalDates(dueStr: string): { start: string; end: string } | null {
  const match = dueStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const [_, y, m, d] = match;
    const year = parseInt(y);
    const month = parseInt(m) - 1;
    const day = parseInt(d);
    const startD = new Date(Date.UTC(year, month, day));
    const endD = new Date(Date.UTC(year, month, day + 1));
    const fmt = (date: Date): string => {
      const ys = String(date.getUTCFullYear());
      const ms = String(date.getUTCMonth() + 1).padStart(2, "0");
      const ds = String(date.getUTCDate()).padStart(2, "0");
      return `${ys}${ms}${ds}`;
    };
    return { start: fmt(startD), end: fmt(endD) };
  }

  const parsed = new Date(dueStr);
  if (!isNaN(parsed.getTime())) {
    const startD = new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate(),
      ),
    );
    const endD = new Date(
      Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate() + 1,
      ),
    );
    const fmt = (date: Date): string => {
      const ys = String(date.getUTCFullYear());
      const ms = String(date.getUTCMonth() + 1).padStart(2, "0");
      const ds = String(date.getUTCDate()).padStart(2, "0");
      return `${ys}${ms}${ds}`;
    };
    return { start: fmt(startD), end: fmt(endD) };
  }
  return null;
}

function readJsonRequest(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("JSON body must be an object."));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

function writeJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

/**
 * Handle incoming HTTP requests securely.
 */
function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(
    req.url || "",
    `http://${req.headers.host || "127.0.0.1"}`,
  );

  // iCal calendar feed synchronization route
  if (req.method === "GET" && url.pathname === "/calendar.ics") {
    if (!isCalendarAuthorized(req, url)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ error: "Unauthorized. Token mismatch or missing." }),
      );
      return;
    }

    const profile = getActiveProfileNameSync();
    getSpsNoteIndex(profile)
      .then((index) => {
        const notes = index.query({
          filters: [{ prop: "due", op: "exists" }],
        });

        const ical = [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Hermes//SPS Task Sync//EN",
          "CALSCALE:GREGORIAN",
          "METHOD:PUBLISH",
        ];

        for (const note of notes) {
          const dueStr = String(note.props.due || "");
          const dates = getICalDates(dueStr);
          if (!dates) continue;

          const uid = `${note.path.replace(/\//g, "-")}@hermes`;
          const title = String(
            note.props.title || note.title || basename(note.path, ".md"),
          );
          const status = String(note.props.status || "todo");
          const prio = String(note.props.prio || "med");
          const assignee = String(
            note.props.who || note.props.assignee || "you",
          );
          const desc = `Status: ${status}\\nPriority: ${prio}\\nAssignee: ${assignee}`;
          const nowStr =
            new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

          ical.push(
            "BEGIN:VEVENT",
            `UID:${uid}`,
            `DTSTAMP:${nowStr}`,
            `DTSTART;VALUE=DATE:${dates.start}`,
            `DTEND;VALUE=DATE:${dates.end}`,
            `SUMMARY:${title}`,
            `DESCRIPTION:${desc}`,
            "STATUS:CONFIRMED",
            "END:VEVENT",
          );
        }

        ical.push("END:VCALENDAR");

        res.writeHead(200, {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": "attachment; filename=calendar.ics",
        });
        res.end(ical.join("\r\n"));
      })
      .catch((err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: `Internal server error: ${err.message}` }),
        );
      });
    return;
  }

  // Enforce security checks: check Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Unauthorized. Missing or invalid Bearer token.",
      }),
    );
    return;
  }

  if (!hasBearerControlToken(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized. Token mismatch." }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/state") {
    const profile = getActiveProfileNameSync();
    const conn = getConnectionConfig();
    const gatewayRunning = isGatewayRunning(profile);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        profile,
        connectionMode: conn.mode,
        gatewayRunning,
        controlPort: currentPort,
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/sps/status") {
    const profile = getActiveProfileNameSync();
    getSpsNoteIndex(profile)
      .then((index) => writeJson(res, 200, index.status()))
      .catch((err) =>
        writeJson(res, 500, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "GET" && url.pathname === "/sps/search") {
    const profile = getActiveProfileNameSync();
    const q = url.searchParams.get("q") || "";
    const limit = Number(url.searchParams.get("limit") || 20);
    getSpsNoteIndex(profile)
      .then((index) => writeJson(res, 200, index.search(q, limit)))
      .catch((err) =>
        writeJson(res, 500, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "GET" && url.pathname === "/sps/page") {
    const profile = getActiveProfileNameSync();
    const page = (url.searchParams.get("page") || "").replace(/\.md$/i, "");
    readPageMarkdownFrom(resolveSpsVaultDir(profile), page)
      .then((markdown) =>
        markdown === null
          ? writeJson(res, 404, { error: "Page not found." })
          : writeJson(res, 200, { page, markdown }),
      )
      .catch((err) =>
        writeJson(res, 500, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/context-pack") {
    void readJsonRequest(req)
      .then((payload) => {
        const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
        if (!pageId) {
          writeJson(res, 400, { error: "Missing required field: pageId." });
          return;
        }
        const profile = getActiveProfileNameSync();
        return buildContextPack(
          {
            pageId,
            depth:
              typeof payload.depth === "number" ? payload.depth : undefined,
            includeBacklinks: payload.includeBacklinks !== false,
            includeTasks: payload.includeTasks !== false,
            includeSources: payload.includeSources !== false,
            maxBytes:
              typeof payload.maxBytes === "number"
                ? payload.maxBytes
                : undefined,
            save: payload.save === true,
          },
          profile,
        ).then((result) => writeJson(res, 200, result));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/capture") {
    void readJsonRequest(req)
      .then((payload) => {
        const body = typeof payload.body === "string" ? payload.body : "";
        if (!body.trim()) {
          writeJson(res, 400, { error: "Missing required field: body." });
          return;
        }
        const profile = getActiveProfileNameSync();
        return writeSpsCapture(resolveSpsVaultDir(profile), {
          source: payload.source === "web" ? "web" : "quick-note",
          body,
          title: typeof payload.title === "string" ? payload.title : undefined,
          description:
            typeof payload.description === "string"
              ? payload.description
              : undefined,
          via: typeof payload.via === "string" ? payload.via : "local-api",
          url: typeof payload.url === "string" ? payload.url : undefined,
          selection:
            typeof payload.selection === "string"
              ? payload.selection
              : undefined,
          highlights: Array.isArray(payload.highlights)
            ? payload.highlights.filter(
                (h): h is string => typeof h === "string",
              )
            : undefined,
          capturedAt:
            typeof payload.capturedAt === "number"
              ? payload.capturedAt
              : Date.now(),
        }).then((result) => writeJson(res, result.success ? 200 : 500, result));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/page") {
    void readJsonRequest(req)
      .then((payload) => {
        const pageId = typeof payload.pageId === "string" ? payload.pageId : "";
        const markdown =
          typeof payload.markdown === "string" ? payload.markdown : "";
        if (!pageId || !markdown) {
          writeJson(res, 400, {
            error: "Missing required fields: pageId and markdown.",
          });
          return;
        }
        const profile = getActiveProfileNameSync();
        return exportPageMarkdownTo(
          resolveSpsVaultDir(profile),
          pageId,
          markdown,
        ).then((ok) => writeJson(res, ok ? 200 : 400, { success: ok }));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/sps/task") {
    void readJsonRequest(req)
      .then((payload) => {
        const dbFolder =
          typeof payload.dbFolder === "string" ? payload.dbFolder : "tasks";
        const rowId =
          typeof payload.rowId === "string"
            ? payload.rowId
            : `task_${Date.now()}`;
        const markdown =
          typeof payload.markdown === "string" ? payload.markdown : "";
        if (!markdown) {
          writeJson(res, 400, { error: "Missing required field: markdown." });
          return;
        }
        const profile = getActiveProfileNameSync();
        return exportRowMarkdownTo(
          resolveSpsVaultDir(profile),
          dbFolder,
          rowId,
          markdown,
        ).then((ok) => writeJson(res, ok ? 200 : 400, { success: ok, rowId }));
      })
      .catch((err) =>
        writeJson(res, 400, { error: String(err.message || err) }),
      );
    return;
  }

  if (req.method === "POST" && url.pathname === "/query") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    const handleQuery = async (): Promise<void> => {
      try {
        const payload = JSON.parse(body);
        const { message, resumeSessionId, groundInWorkspace } = payload;
        if (!message) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Missing required field: 'message'." }),
          );
          return;
        }

        const profile = getActiveProfileNameSync();

        // Handle SSE streaming or full response based on Accept header
        const acceptsEventStream = req.headers.accept === "text/event-stream";

        if (acceptsEventStream) {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });

          await sendMessage(
            message,
            {
              onChunk: (chunk) => {
                res.write(
                  `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`,
                );
              },
              onDone: (sessionId) => {
                res.write(
                  `data: ${JSON.stringify({ type: "done", sessionId })}\n\n`,
                );
                res.end();
              },
              onError: (err) => {
                res.write(
                  `data: ${JSON.stringify({ type: "error", error: err })}\n\n`,
                );
                res.end();
              },
            },
            profile,
            resumeSessionId,
            undefined,
            undefined,
            undefined,
            groundInWorkspace,
          );
        } else {
          let fullText = "";
          await sendMessage(
            message,
            {
              onChunk: (chunk) => {
                fullText += chunk;
              },
              onDone: (sessionId) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ response: fullText, sessionId }));
              },
              onError: (err) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: err }));
              },
            },
            profile,
            resumeSessionId,
            undefined,
            undefined,
            undefined,
            groundInWorkspace,
          );
        }
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body." }));
      }
    };
    req.on("end", () => {
      handleQuery().catch((error) => {
        handleAsyncRequestFailure(res, "/query", error);
      });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/cron/create") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    const handleCronCreate = async (): Promise<void> => {
      try {
        const payload = JSON.parse(body);
        const { schedule, prompt, name, deliver, opts } = payload;
        if (!schedule) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Missing required field: 'schedule'." }),
          );
          return;
        }

        const profile = getActiveProfileNameSync();
        const result = await createCronJob(
          schedule,
          prompt,
          name,
          deliver,
          profile,
          opts,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : "Invalid JSON body.",
          }),
        );
      }
    };
    req.on("end", () => {
      handleCronCreate().catch((error) => {
        handleAsyncRequestFailure(res, "/cron/create", error);
      });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/cron/trigger") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    const handleCronTrigger = async (): Promise<void> => {
      try {
        const payload = JSON.parse(body);
        const { jobId, jobName } = payload;
        if (!jobId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({ error: "Missing required field: 'jobId'." }),
          );
          return;
        }

        const profile = getActiveProfileNameSync();
        // Spawns headless routines execution asynchronously
        const success = await runJobHeadless(
          jobId,
          jobName || "Manual Trigger",
          profile,
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body." }));
      }
    };
    req.on("end", () => {
      handleCronTrigger().catch((error) => {
        handleAsyncRequestFailure(res, "/cron/trigger", error);
      });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/cron/trigger-due") {
    const profile = getActiveProfileNameSync();
    tickScheduler(profile).catch((error) => {
      log.error("control-server", {
        msg: "trigger-due scheduler tick failed",
        profile,
        error: formatLogError(error),
      });
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Endpoint not found." }));
}

/**
 * Try listening on a port. Fallbacks dynamically if the port is in use.
 */
function listenOnPort(port: number, maxAttempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!serverInstance) {
      reject(new Error("Server instance not initialized."));
      return;
    }

    const cleanup = (): void => {
      serverInstance?.removeListener("listening", onListening);
      serverInstance?.removeListener("error", onError);
    };

    const onListening = (): void => {
      cleanup();
      currentPort = port;
      log.info("control-server", {
        msg: "running successfully",
        url: `http://127.0.0.1:${port}`,
        port,
      });

      // Save port and token back to desktop.json so external clients can auto-discover it
      const config = readDesktopConfig();
      config.controlServerPort = port;
      const activeProfile = getActiveProfileNameSync() || "default";
      const connectionMode = getConnectionConfig().mode;
      config.gatewaySupervisor = {
        enabled: connectionMode === "local",
        mode: connectionMode,
        profile: activeProfile,
        port: connectionMode === "local" ? getProfilePort(activeProfile) : null,
      };
      writeDesktopConfig(config);

      writeShellHelper(port, authToken);
      const cronArtifactInstalled = installCronArtifact();

      const backgroundEnabled = config.backgroundSchedulingEnabled !== false;
      manageLaunchAgent(backgroundEnabled && cronArtifactInstalled);

      resolve(port);
    };

    const onError = (err: { code?: string }): void => {
      cleanup();
      if (err.code === "EADDRINUSE" && maxAttempts > 0) {
        log.warn("control-server", {
          msg: "port in use; retrying",
          port,
          nextPort: port + 1,
        });
        resolve(listenOnPort(port + 1, maxAttempts - 1));
      } else {
        reject(err);
      }
    };

    serverInstance.on("listening", onListening);
    serverInstance.on("error", onError);
    serverInstance.listen(port, "127.0.0.1");
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function controlServerTokenFile(): string {
  return join(HERMES_HOME, "control-server.token");
}

function writeControlTokenFile(token: string): string {
  const tokenPath = controlServerTokenFile();
  safeWriteFile(tokenPath, `${token}\n`);
  try {
    chmodSync(tokenPath, 0o600);
  } catch {
    /* best effort */
  }
  return tokenPath;
}

export function renderShellHelperScript(
  port: number,
  tokenFilePath: string,
): string {
  return `#!/bin/bash
# Auto-generated by Hermes Control Server
DESKTOP_JSON="$HOME/.hermes/desktop.json"
PORT="${port}"
TOKEN_FILE=${shellQuote(tokenFilePath)}
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\\r\\n')"

if [ -z "$TOKEN" ]; then
  echo "Hermes control-server token is unavailable."
  exit 1
fi

if [ "$1" = "--state" ] || [ "$1" = "-s" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/state"
elif [ "$1" = "--trigger-due" ] || [ "$1" = "-d" ]; then
  curl -s -H "Authorization: Bearer $TOKEN" -X POST "http://127.0.0.1:$PORT/cron/trigger-due"
elif [ "$1" = "--trigger" ] || [ "$1" = "-t" ]; then
  if [ -z "$2" ]; then
    echo "Usage: hermes-ask --trigger <jobId> [jobName]"
    exit 1
  fi
  curl -s -H "Authorization: Bearer $TOKEN" -X POST -H "Content-Type: application/json" -d "{\\"jobId\\":\\"$2\\",\\"jobName\\":\\"$3\\"}" "http://127.0.0.1:$PORT/cron/trigger"
else
  if [ -z "$1" ]; then
    echo "Usage: hermes-ask <message> OR hermes-ask --state OR hermes-ask --trigger-due OR hermes-ask --trigger <jobId>"
    exit 1
  fi
  curl -s -H "Authorization: Bearer $TOKEN" -X POST -H "Content-Type: application/json" -d "{\\"message\\":\\"$1\\"}" "http://127.0.0.1:$PORT/query"
fi
`;
}

export function renderSpsHelperScript(
  port: number,
  tokenFilePath: string,
): string {
  return `#!/bin/bash
# Auto-generated by Hermes Control Server
PORT="${port}"
TOKEN_FILE=${shellQuote(tokenFilePath)}
TOKEN="$(cat "$TOKEN_FILE" 2>/dev/null | tr -d '\\r\\n')"
BASE="http://127.0.0.1:$PORT"

if [ -z "$TOKEN" ]; then
  echo "Hermes control-server token is unavailable."
  exit 1
fi

case "$1" in
  status)
    curl -s -H "Authorization: Bearer $TOKEN" "$BASE/sps/status"
    ;;
  search)
    if [ -z "$2" ]; then
      echo "Usage: sps search <query>"
      exit 1
    fi
    curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "q=$2" "$BASE/sps/search"
    ;;
  read)
    if [ -z "$2" ]; then
      echo "Usage: sps read <pageId>"
      exit 1
    fi
    curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "page=$2" "$BASE/sps/page"
    ;;
  capture)
    if [ -z "$2" ]; then
      echo "Usage: sps capture <text> [url]"
      exit 1
    fi
    BODY="$2"
    URL="$3"
    JSON_PAYLOAD=$(node -e 'const [body,url]=process.argv.slice(1); const payload=url ? {source:"web", body, url} : {source:"quick-note", body}; process.stdout.write(JSON.stringify(payload));' "$BODY" "$URL")
    curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$JSON_PAYLOAD" "$BASE/sps/capture"
    ;;
  *)
    echo "Usage: sps status | search <query> | read <pageId> | capture <text> [url]"
    exit 1
    ;;
esac
`;
}

function writeShellHelper(port: number, token: string): void {
  try {
    const binDir = join(homedir(), ".hermes", "bin");
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    const helperPath = join(binDir, "hermes-ask");
    const tokenPath = writeControlTokenFile(token);
    safeWriteFile(helperPath, renderShellHelperScript(port, tokenPath));
    chmodSync(helperPath, 0o755);
    writeSpsHelper(binDir, port, tokenPath);
    writeTaskProposalHelper(binDir);
    log.info("control-server", {
      msg: "generated OS-native CLI tool",
      path: helperPath,
    });
  } catch (err) {
    log.error("control-server", {
      msg: "failed to write hermes-ask shell helper",
      error: formatLogError(err),
    });
  }
}

export function renderTaskProposalHelperScript(): string {
  return `#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function fail(message) {
  process.stderr.write(message + '\n');
  process.exit(2);
}

const values = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key || !key.startsWith('--') || value === undefined) {
    fail('Usage: sps-propose-task --title <text> --source-message-id <id> [--body <text>] [--due YYYY-MM-DD] [--priority high|med|low] [--source telegram|email]');
  }
  values[key.slice(2)] = value;
}

const title = String(values.title || '').trim();
const requestId = String(values['source-message-id'] || '').trim();
if (!title || title.length > 240) fail('Task title must be 1-240 characters.');
if (!requestId || requestId.length > 240) fail('A stable source message id is required.');
if (values.due && !/^\\d{4}-\\d{2}-\\d{2}$/.test(values.due)) fail('Due date must use YYYY-MM-DD.');
if (values.priority && !['high', 'med', 'low'].includes(values.priority)) fail('Priority must be high, med, or low.');
if (values.source && !['telegram', 'email'].includes(values.source)) fail('Source must be telegram or email.');

const hermesHome = path.join(os.homedir(), '.hermes');
let activeProfile = 'default';
try {
  const desktop = JSON.parse(fs.readFileSync(path.join(hermesHome, 'desktop.json'), 'utf-8'));
  if (typeof desktop.activeProfile === 'string' && desktop.activeProfile) activeProfile = desktop.activeProfile;
} catch (err) {}
const requestedProfile = String(values.profile || process.env.HERMES_PROFILE || activeProfile);
if (!/^[A-Za-z0-9_-]+$/.test(requestedProfile)) fail('Invalid profile name.');
const profileRoot = requestedProfile === 'default'
  ? hermesHome
  : path.join(hermesHome, 'profiles', requestedProfile);
const inbox = path.join(profileRoot, 'sps-agent', 'task-proposals', 'inbox');
fs.mkdirSync(inbox, { recursive: true });
const id = crypto.randomUUID();
const target = path.join(inbox, id + '.json');
const temporary = target + '.tmp';
const payload = {
  requestId,
  title,
  body: String(values.body || '').slice(0, 10000),
  due: values.due || undefined,
  priority: values.priority || undefined,
  requester: values.requester || undefined,
  source: values.source || 'telegram',
  requestedAt: Date.now()
};
fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { encoding: 'utf-8', mode: 0o600 });
fs.renameSync(temporary, target);
process.stdout.write(JSON.stringify({ success: true, proposalId: id, status: 'pending-approval' }) + '\n');
`;
}

function writeTaskProposalHelper(binDir: string): void {
  const helperPath = join(binDir, "sps-propose-task");
  safeWriteFile(helperPath, renderTaskProposalHelperScript());
  chmodSync(helperPath, 0o755);
}

function writeSpsHelper(binDir: string, port: number, tokenPath: string): void {
  const helperPath = join(binDir, "sps");
  safeWriteFile(helperPath, renderSpsHelperScript(port, tokenPath));
  chmodSync(helperPath, 0o755);
}

function installCronArtifact(): boolean {
  const sourcePath = getBundledScriptPath("hermes-cron.cjs");
  const binDir = join(getHermesHome(), "bin");
  const destinationPath = join(binDir, "hermes-cron.cjs");
  const temporaryPath = `${destinationPath}.tmp-${process.pid}`;

  if (!existsSync(sourcePath)) {
    log.error("control-server", {
      msg: "bundled cron artifact is missing",
      sourcePath,
    });
    return false;
  }

  try {
    if (!existsSync(binDir)) {
      mkdirSync(binDir, { recursive: true });
    }
    copyFileSync(sourcePath, temporaryPath);
    chmodSync(temporaryPath, 0o755);
    renameSync(temporaryPath, destinationPath);
    log.info("control-server", {
      msg: "installed bundled cron artifact",
      sourcePath,
      path: destinationPath,
    });
    return true;
  } catch (err) {
    try {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
    } catch {
      // The install error below remains the actionable failure.
    }
    log.error("control-server", {
      msg: "failed to install bundled cron artifact",
      sourcePath,
      path: destinationPath,
      error: formatLogError(err),
    });
    return false;
  }
}

function findNodePath(): string {
  const commonPaths = [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
  ];
  for (const p of commonPaths) {
    if (existsSync(p)) return p;
  }
  return process.execPath;
}

function launchdGuiTarget(): string | null {
  const uid = process.getuid?.();
  return typeof uid === "number" ? `gui/${uid}` : null;
}

function escapePlistXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return character;
    }
  });
}

export function manageLaunchAgent(enabled: boolean): void {
  if (process.platform !== "darwin") return;

  const home = homedir();
  const hermesHome = getHermesHome();
  const plistDir = join(home, "Library", "LaunchAgents");
  const plistPath = join(plistDir, "com.nousresearch.hermes-scheduler.plist");
  const logsDir = join(hermesHome, "logs");
  const guiTarget = launchdGuiTarget();
  if (!guiTarget) return;

  if (!existsSync(plistDir)) {
    try {
      mkdirSync(plistDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  execFile(
    "launchctl",
    ["bootout", guiTarget, plistPath],
    { shell: false },
    () => {
      if (!enabled) {
        try {
          if (existsSync(plistPath)) {
            unlinkSync(plistPath);
          }
        } catch {
          // ignore
        }
        return;
      }

      const nodePath = findNodePath();
      const cronScriptPath = join(hermesHome, "bin", "hermes-cron.cjs");
      const launchdLogPath = join(logsDir, "launchd-scheduler.log");
      const isElectron = nodePath === process.execPath;
      const environmentEntries = [
        "        <key>HERMES_HOME</key>",
        `        <string>${escapePlistXml(hermesHome)}</string>`,
      ];
      if (isElectron) {
        environmentEntries.push(
          "        <key>ELECTRON_RUN_AS_NODE</key>",
          "        <string>1</string>",
        );
      }
      const envBlock = [
        "    <key>EnvironmentVariables</key>",
        "    <dict>",
        ...environmentEntries,
        "    </dict>",
      ].join("\n");

      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.nousresearch.hermes-scheduler</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escapePlistXml(nodePath)}</string>
        <string>${escapePlistXml(cronScriptPath)}</string>
    </array>
    <key>StartInterval</key>
    <integer>60</integer>
    <key>RunAtLoad</key>
    <true/>
${envBlock}
    <key>StandardOutPath</key>
    <string>${escapePlistXml(launchdLogPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapePlistXml(launchdLogPath)}</string>
</dict>
</plist>
`;

      try {
        if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
        writeFileSync(plistPath, plistContent, "utf-8");

        execFile(
          "launchctl",
          ["bootstrap", guiTarget, plistPath],
          { shell: false },
          (err) => {
            if (err) {
              log.error("control-server", {
                msg: "failed to bootstrap launchd plist",
                error: err.message,
              });
            } else {
              log.info("control-server", {
                msg: "successfully bootstrapped launchd plist",
              });
            }
          },
        );
      } catch (err) {
        log.error("control-server", {
          msg: "error writing LaunchAgent plist",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );
}

/**
 * Start the control server.
 */
export async function startControlServer(): Promise<number> {
  if (serverInstance) {
    log.warn("control-server", { msg: "server is already running" });
    return currentPort;
  }

  ensureAuthToken();
  ensureCalendarFeedToken();

  serverInstance = createServer(handleRequest);
  try {
    const port = await listenOnPort(8645);
    return port;
  } catch (err) {
    log.error("control-server", {
      msg: "failed to start control server",
      error: formatLogError(err),
    });
    serverInstance = null;
    throw err;
  }
}

/**
 * Stop the control server.
 */
export function stopControlServer(): Promise<void> {
  if (!serverInstance) return Promise.resolve();
  const server = serverInstance;
  serverInstance = null;
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}
