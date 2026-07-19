// lib/api/media.ts — the renderer's single import seam for agent-delivered
// media (data-URL resolution, save/open native menus, attachment staging).
//
// Data-access layer: today these are deliberate pass-throughs to
// window.hermesAPI — the value is the SEAM. Components import the domain,
// not the global, so the domain's IPC surface is greppable in one place and
// error normalization / caching / connection-mode branching has exactly one
// home when it becomes needed. New media call sites MUST be added here
// first, then imported. See docs/REFACTOR-AUDIT-2026-07-18.md §2.
//
// First migrated consumers: components/MediaImage.tsx,
// screens/Chat/attachmentUtils.ts, screens/Chat/Chat.tsx.

export function readMediaFile(
  filePath: string,
): ReturnType<Window["hermesAPI"]["readMediaFile"]> {
  return window.hermesAPI.readMediaFile(filePath);
}

export function saveMediaFile(
  src: string,
  name: string,
): ReturnType<Window["hermesAPI"]["saveMediaFile"]> {
  return window.hermesAPI.saveMediaFile(src, name);
}

export function mediaFileExists(
  filePath: string,
): ReturnType<Window["hermesAPI"]["mediaFileExists"]> {
  return window.hermesAPI.mediaFileExists(filePath);
}

export function showMediaMenu(
  src: string,
  name: string,
  labels: { open: string; saveAs: string },
): ReturnType<Window["hermesAPI"]["showMediaMenu"]> {
  return window.hermesAPI.showMediaMenu(src, name, labels);
}

export function stageAttachment(
  sessionId: string,
  filename: string,
  base64Bytes: string,
): ReturnType<Window["hermesAPI"]["stageAttachment"]> {
  return window.hermesAPI.stageAttachment(sessionId, filename, base64Bytes);
}

export function clearStagedAttachments(
  sessionId: string,
): ReturnType<Window["hermesAPI"]["clearStagedAttachments"]> {
  return window.hermesAPI.clearStagedAttachments(sessionId);
}
