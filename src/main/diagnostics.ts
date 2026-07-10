import type { App } from "electron";
import { formatLogError, log } from "./log";

let installed = false;

/** Install the process- and Electron-level crash sinks exactly once. */
export function installDiagnostics(app: App): void {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (error) => {
    log.error("crash", {
      msg: "uncaughtException",
      error: formatLogError(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });
  process.on("unhandledRejection", (reason) => {
    log.error("crash", {
      msg: "unhandledRejection",
      error: formatLogError(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  app.on("render-process-gone", (_event, _webContents, details) => {
    log.error("crash", {
      msg: "render-process-gone",
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
  app.on("child-process-gone", (_event, details) => {
    log.error("crash", {
      msg: "child-process-gone",
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
}
