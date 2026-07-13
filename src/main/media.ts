/**
 * Main-process helpers for rendering and saving agent-generated media
 * (issue #299). The agent delivers files via `MEDIA:` tokens; the renderer
 * resolves local paths to data URLs through `readMediaAsDataUrl`, and lets
 * the user save any media (data URL / http(s) URL / local path) to disk
 * via `saveMedia`.
 */

import {
  mkdirSync,
  realpathSync,
  writeFileSync,
  copyFileSync,
  statSync,
  promises as fsPromises,
} from "fs";
import { extname, isAbsolute, join, relative, resolve } from "path";
import { BrowserWindow, dialog } from "electron";
import { safeFetch } from "./security/ssrf-guard";
import { assertGrantedFilePath } from "./file-access-grants";
import { HERMES_HOME } from "./installer/paths";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const MEDIA_OUTPUT_DIR = join(HERMES_HOME, "media-output");

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
};

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

export function prepareMediaOutputDirectory(): string {
  mkdirSync(MEDIA_OUTPUT_DIR, { recursive: true });
  return MEDIA_OUTPUT_DIR;
}

/** Resolve a renderer-supplied media path only when the user granted it or the
 * agent wrote it into the dedicated media-output directory. Realpath checks
 * make symlinks unable to escape either boundary. */
export function resolveAllowedMediaPath(filePath: string): string {
  try {
    return assertGrantedFilePath(filePath);
  } catch {
    const normalized = realpathSync(resolve(filePath));
    const outputRoot = realpathSync(prepareMediaOutputDirectory());
    if (!statSync(normalized).isFile() || !isWithin(outputRoot, normalized)) {
      throw new Error("Media path was not granted by the user or agent output");
    }
    return normalized;
  }
}

/**
 * Read a local image file and return it as a `data:` URL. Returns null when
 * the file is missing, not an image, too large, or unreadable.
 */
export async function readMediaAsDataUrl(
  filePath: string,
): Promise<string | null> {
  try {
    if (!filePath) return null;
    const allowedPath = resolveAllowedMediaPath(filePath);
    const stat = await fsPromises.stat(allowedPath);
    if (!stat.isFile() || stat.size > MAX_MEDIA_BYTES) return null;
    const ext = extname(allowedPath).toLowerCase();
    const mime = MIME_BY_EXT[ext];
    if (!mime) return null;
    const buffer = await fsPromises.readFile(allowedPath);
    return `data:${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * True only when `filePath` points at an existing regular file. Used to
 * verify a bare (untagged) path the agent mentioned really is a delivered
 * file before the renderer treats it as media (issue #299).
 */
export function mediaFileExists(filePath: string): boolean {
  try {
    if (!filePath) return false;
    return statSync(resolveAllowedMediaPath(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Prompt the user for a destination and write `src` there. `src` may be a
 * `data:` URL, an http(s) URL, or a local filesystem path. Returns true on
 * success, false when canceled or on any error.
 */
export async function saveMedia(
  src: string,
  suggestedName: string,
  win: BrowserWindow | null,
): Promise<boolean> {
  try {
    const isData = src.startsWith("data:");
    const isUrl = /^https?:\/\//i.test(src);
    const safeSrc = isData || isUrl ? src : resolveAllowedMediaPath(src);
    const result = win
      ? await dialog.showSaveDialog(win, { defaultPath: suggestedName })
      : await dialog.showSaveDialog({ defaultPath: suggestedName });
    if (result.canceled || !result.filePath) return false;
    const dest = result.filePath;

    if (isData) {
      const comma = safeSrc.indexOf(",");
      if (comma === -1) return false;
      writeFileSync(dest, Buffer.from(safeSrc.slice(comma + 1), "base64"));
      return true;
    }

    if (isUrl) {
      const response = await safeFetch(safeSrc, {
        redirect: "follow",
        headers: { "User-Agent": "HermesDesktop/1.0 (+media-saver)" },
      });
      if (!response.ok) return false;
      const buffer = Buffer.from(await response.arrayBuffer());
      writeFileSync(dest, buffer);
      return true;
    }

    copyFileSync(safeSrc, dest);
    return true;
  } catch {
    return false;
  }
}
