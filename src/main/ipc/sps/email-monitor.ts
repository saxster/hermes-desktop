import { shell } from "electron";
import { safeHandle } from "../safe-handle";
import { requireLocalWorkspace } from "../connection-guards";
import {
  applyEmailMonitorFeedbackForProfile,
  getEmailMonitorConfig,
  getEmailMonitorStatus,
  runEmailMonitorNow,
  saveEmailMonitorConfig,
} from "../../email-monitor";
import { runInboxDigestNow } from "../../inbox-digest";
import type {
  EmailMonitorConfig,
  EmailMonitorFeedback,
} from "../../../shared/email-monitor";
import { draftReplyFromCapture } from "../../email-draft";
import { SPS_INBOX_FOLDER } from "../../sps-capture";
import { resolveSpsVaultDir } from "../../sps-storage";
import { readRowMarkdownFrom } from "../../sps-vault";
import {
  buildMailtoUrl,
  type EmailReplyDraft,
} from "../../../shared/email-actions";
import { formatLogError, log } from "../../log";

export function registerSpsEmailMonitorIpc(): void {
  safeHandle("sps-email-monitor-get-config", (_event, profile?: string) => {
    requireLocalWorkspace();
    return getEmailMonitorConfig(profile);
  });
  safeHandle(
    "sps-email-monitor-save-config",
    (_event, config: EmailMonitorConfig, profile?: string) => {
      requireLocalWorkspace();
      return saveEmailMonitorConfig(config, profile);
    },
  );
  safeHandle("sps-email-monitor-status", (_event, profile?: string) => {
    requireLocalWorkspace();
    return getEmailMonitorStatus(profile);
  });
  safeHandle("sps-email-monitor-run-now", (_event, profile?: string) => {
    requireLocalWorkspace();
    return runEmailMonitorNow(profile);
  });
  safeHandle(
    "sps-email-monitor-apply-feedback",
    (_event, feedback: EmailMonitorFeedback, profile?: string) => {
      requireLocalWorkspace();
      return applyEmailMonitorFeedbackForProfile(feedback, profile);
    },
  );
  // Email Actions: draft an AI reply to a captured email. The draft comes back
  // for human review; sending always happens in the user's own mail client.
  safeHandle(
    "sps-email-draft-reply",
    async (_event, captureId: string, profile?: string) => {
      requireLocalWorkspace();
      const vaultDir = resolveSpsVaultDir(profile);
      const markdown = await readRowMarkdownFrom(
        vaultDir,
        SPS_INBOX_FOLDER,
        captureId,
      );
      if (markdown == null) return { ok: false, error: "capture-not-found" };
      return draftReplyFromCapture(markdown, { profile });
    },
  );
  // Hand the reviewed draft to the native Mail app via a mailto: URL built in
  // main from validated data (mirrors the contact-channel hand-off rationale).
  safeHandle("sps-email-open-reply", async (_event, draft: EmailReplyDraft) => {
    requireLocalWorkspace();
    const url = buildMailtoUrl(draft);
    if (!url) return false;
    try {
      await shell.openExternal(url);
      return true;
    } catch (err) {
      log.error("email-monitor-ipc", {
        msg: "reply hand-off failed",
        error: formatLogError(err),
      });
      return false;
    }
  });
  // Daily inbox digest: roll today's triaged email captures into one digest
  // row in vault/digests/. Also runs automatically once per local day from the
  // scheduler; this is the on-demand path for the inbox surface.
  safeHandle("sps-inbox-digest-run-now", (_event, profile?: string) => {
    requireLocalWorkspace();
    return runInboxDigestNow(profile);
  });
}
