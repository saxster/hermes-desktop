// meetings.ts — meeting transcript intake + extraction IPC.
//
// sps-import-transcript writes a pasted/dropped transcript as a normalized
// _inbox capture (source: "meeting"); sps-meeting-extract turns that capture
// into a review-queue proposal (meeting page + action-item tasks). Approval in
// the AI Review Queue is the only write boundary.
import { safeHandle } from "../safe-handle";
import { requireLocalWorkspace } from "../connection-guards";
import { writeSpsCapture } from "../../sps-capture";
import { resolveSpsVaultDir } from "../../sps-storage";
import { proposeMeetingExtraction } from "../../meeting-extract";
import {
  normalizeTranscript,
  normalizeTranscriptImport,
  parseTranscript,
} from "../../../shared/meeting";

export function registerSpsMeetingsIpc(): void {
  safeHandle(
    "sps-import-transcript",
    (_event, input: unknown, profile?: string) => {
      requireLocalWorkspace();
      const normalized = normalizeTranscriptImport(input);
      if (!normalized) return { success: false, error: "invalid-transcript" };
      const segments = parseTranscript(normalized.content);
      const body = segments.length
        ? normalizeTranscript(segments)
        : normalized.content;
      return writeSpsCapture(resolveSpsVaultDir(profile), {
        source: "meeting",
        title: normalized.title || "Meeting transcript",
        body,
        capturedAt: Date.now(),
        captureKind: "meeting",
        schema: "meeting",
      });
    },
  );

  safeHandle(
    "sps-meeting-extract",
    (_event, captureId: string, profile?: string) => {
      requireLocalWorkspace();
      return proposeMeetingExtraction(captureId, profile);
    },
  );
}
