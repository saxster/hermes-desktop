import { shell } from "electron";
import { isAllowedObsidianExternalUrl } from "./obsidian";
import { isAllowedExternalUrl } from "./security";
import { formatLogError, log } from "./log";

/** Open a user-facing URL only after the shared protocol allowlist accepts it. */
export function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    log.warn("security", {
      msg: "blocked unsafe external URL",
      url: typeof rawUrl === "string" ? rawUrl : undefined,
    });
    return;
  }

  void shell.openExternal(rawUrl).catch((error) => {
    log.error("security", {
      msg: "failed to open external URL",
      url: rawUrl,
      error: formatLogError(error),
    });
  });
}
