// lib/api/chat.ts — the renderer's single import seam for the chat runtime:
// sending/aborting turns, turn-event subscriptions (chunks, reasoning, tool
// progress, usage, approvals, delegations, context-menu actions), council
// adoption, and session history (list/search/rename/delete/read).
//
// Data-access layer: today these are deliberate pass-throughs to
// window.hermesAPI — the value is the SEAM. Components import the domain,
// not the global, so the domain's IPC surface is greppable in one place and
// error normalization / caching / connection-mode branching has exactly one
// home when it becomes needed. New chat call sites MUST be added here
// first, then imported. See docs/REFACTOR-AUDIT-2026-07-18.md §2.
//
// Wrappers spread their Parameters<> tuple so a call's arity is forwarded
// exactly — fn(id) reaches the bridge as fn(id), never fn(id, undefined).
//
// First migrated consumers: screens/Chat/{Chat.tsx,useChatSignals.ts,
// hooks/useChatIPC.ts,hooks/useChatActions.ts},
// screens/SpsAgent/store/slices/assistant.ts,
// screens/SpsAgent/activeWork/ActiveWorkSurface.tsx,
// screens/SpsAgent/equity/useEquityRun.ts,
// screens/SpsAgent/shell/ChatSurface.tsx,
// screens/SpsAgent/sidebar/SidebarRecents.tsx,
// screens/SpsAgent/cockpit/CockpitSurface.tsx,
// readiness panels and chat entry points.

// ── Turns ──

export function sendMessage(
  ...args: Parameters<Window["hermesAPI"]["sendMessage"]>
): ReturnType<Window["hermesAPI"]["sendMessage"]> {
  return window.hermesAPI.sendMessage(...args);
}

export function abortChat(
  ...args: Parameters<Window["hermesAPI"]["abortChat"]>
): ReturnType<Window["hermesAPI"]["abortChat"]> {
  return window.hermesAPI.abortChat(...args);
}

export function validateChatReadiness(
  ...args: Parameters<Window["hermesAPI"]["validateChatReadiness"]>
): ReturnType<Window["hermesAPI"]["validateChatReadiness"]> {
  return window.hermesAPI.validateChatReadiness(...args);
}

export function adoptCouncilResponse(
  ...args: Parameters<Window["hermesAPI"]["adoptCouncilResponse"]>
): ReturnType<Window["hermesAPI"]["adoptCouncilResponse"]> {
  return window.hermesAPI.adoptCouncilResponse(...args);
}

export function respondApproval(
  ...args: Parameters<Window["hermesAPI"]["respondApproval"]>
): ReturnType<Window["hermesAPI"]["respondApproval"]> {
  return window.hermesAPI.respondApproval(...args);
}

// ── Session history ──

export function listSessions(
  ...args: Parameters<Window["hermesAPI"]["listSessions"]>
): ReturnType<Window["hermesAPI"]["listSessions"]> {
  return window.hermesAPI.listSessions(...args);
}

export function searchSessions(
  ...args: Parameters<Window["hermesAPI"]["searchSessions"]>
): ReturnType<Window["hermesAPI"]["searchSessions"]> {
  return window.hermesAPI.searchSessions(...args);
}

export function updateSessionTitle(
  ...args: Parameters<Window["hermesAPI"]["updateSessionTitle"]>
): ReturnType<Window["hermesAPI"]["updateSessionTitle"]> {
  return window.hermesAPI.updateSessionTitle(...args);
}

export function deleteSession(
  ...args: Parameters<Window["hermesAPI"]["deleteSession"]>
): ReturnType<Window["hermesAPI"]["deleteSession"]> {
  return window.hermesAPI.deleteSession(...args);
}

export function getSessionMessages(
  ...args: Parameters<Window["hermesAPI"]["getSessionMessages"]>
): ReturnType<Window["hermesAPI"]["getSessionMessages"]> {
  return window.hermesAPI.getSessionMessages(...args);
}

// ── Turn events (subscribe → unsubscribe) ──

export function onChatChunk(
  ...args: Parameters<Window["hermesAPI"]["onChatChunk"]>
): ReturnType<Window["hermesAPI"]["onChatChunk"]> {
  return window.hermesAPI.onChatChunk(...args);
}

export function onChatReasoningChunk(
  ...args: Parameters<Window["hermesAPI"]["onChatReasoningChunk"]>
): ReturnType<Window["hermesAPI"]["onChatReasoningChunk"]> {
  return window.hermesAPI.onChatReasoningChunk(...args);
}

export function onChatDone(
  ...args: Parameters<Window["hermesAPI"]["onChatDone"]>
): ReturnType<Window["hermesAPI"]["onChatDone"]> {
  return window.hermesAPI.onChatDone(...args);
}

export function onChatError(
  ...args: Parameters<Window["hermesAPI"]["onChatError"]>
): ReturnType<Window["hermesAPI"]["onChatError"]> {
  return window.hermesAPI.onChatError(...args);
}

export function listHermesRunEvents(
  ...args: Parameters<Window["hermesAPI"]["listHermesRunEvents"]>
): ReturnType<Window["hermesAPI"]["listHermesRunEvents"]> {
  return window.hermesAPI.listHermesRunEvents(...args);
}

export function getHermesRunResume(
  ...args: Parameters<Window["hermesAPI"]["getHermesRunResume"]>
): ReturnType<Window["hermesAPI"]["getHermesRunResume"]> {
  return window.hermesAPI.getHermesRunResume(...args);
}

export function onHermesRunEvent(
  ...args: Parameters<Window["hermesAPI"]["onHermesRunEvent"]>
): ReturnType<Window["hermesAPI"]["onHermesRunEvent"]> {
  return window.hermesAPI.onHermesRunEvent(...args);
}

export function onChatToolProgress(
  ...args: Parameters<Window["hermesAPI"]["onChatToolProgress"]>
): ReturnType<Window["hermesAPI"]["onChatToolProgress"]> {
  return window.hermesAPI.onChatToolProgress(...args);
}

export function onChatUsage(
  ...args: Parameters<Window["hermesAPI"]["onChatUsage"]>
): ReturnType<Window["hermesAPI"]["onChatUsage"]> {
  return window.hermesAPI.onChatUsage(...args);
}

export function onChatApprovalRequest(
  ...args: Parameters<Window["hermesAPI"]["onChatApprovalRequest"]>
): ReturnType<Window["hermesAPI"]["onChatApprovalRequest"]> {
  return window.hermesAPI.onChatApprovalRequest(...args);
}

export function onChatApprovalAuto(
  ...args: Parameters<Window["hermesAPI"]["onChatApprovalAuto"]>
): ReturnType<Window["hermesAPI"]["onChatApprovalAuto"]> {
  return window.hermesAPI.onChatApprovalAuto(...args);
}

export function onChatDelegateProgress(
  ...args: Parameters<Window["hermesAPI"]["onChatDelegateProgress"]>
): ReturnType<Window["hermesAPI"]["onChatDelegateProgress"]> {
  return window.hermesAPI.onChatDelegateProgress(...args);
}

export function onContextMenuCopyChat(
  ...args: Parameters<Window["hermesAPI"]["onContextMenuCopyChat"]>
): ReturnType<Window["hermesAPI"]["onContextMenuCopyChat"]> {
  return window.hermesAPI.onContextMenuCopyChat(...args);
}

export function onContextMenuSelectBubble(
  ...args: Parameters<Window["hermesAPI"]["onContextMenuSelectBubble"]>
): ReturnType<Window["hermesAPI"]["onContextMenuSelectBubble"]> {
  return window.hermesAPI.onContextMenuSelectBubble(...args);
}
