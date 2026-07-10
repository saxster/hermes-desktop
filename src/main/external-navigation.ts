import { shell } from "electron";
import { isAllowedExternalUrl } from "./security";
import { isAllowedObsidianExternalUrl } from "./obsidian";
import { formatLogError, log } from "./log";

/** Open a user-requested external URL after applying the single allowlist. */
export function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl) && !isAllowedObsidianExternalUrl(rawUrl)) {
    log.warn("security", {
      msg: "blocked unsafe external URL",
      url: typeof rawUrl === "string" ? rawUrl : undefined,
    });
    return;
  }

  shell.openExternal(rawUrl as string).catch((err) => {
    log.error("security", {
      msg: "failed to open external URL",
      url: rawUrl as string,
      error: formatLogError(err),
    });
  });
}
