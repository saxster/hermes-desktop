// lib/api/memory.ts — the renderer's single import seam for the agent's
// persistent memory surface: memory.md entries, the user profile, focus.md,
// the soul file, memory-provider discovery, and learning proposals (the
// bridge groups all of these under its own "Memory" section).
//
// Data-access layer: today these are deliberate pass-throughs to
// window.hermesAPI — the value is the SEAM. Components import the domain,
// not the global, so the domain's IPC surface is greppable in one place and
// error normalization / caching / connection-mode branching has exactly one
// home when it becomes needed. New memory call sites MUST be added here
// first, then imported. See docs/REFACTOR-AUDIT-2026-07-18.md §2.
//
// Wrappers spread their Parameters<> tuple so a call's arity is forwarded
// exactly — fn(id) reaches the bridge as fn(id), never fn(id, undefined).
//
// First migrated consumers: screens/SpsAgent/you/{YouSurface,SoulEditor,
// MemoryTimeline}.tsx, screens/SpsAgent/learning/LearningSurface.tsx,
// screens/SpsAgent/cockpit/CockpitSurface.tsx,
// screens/SpsAgent/inbox/ingestApply.ts,
// screens/Chat/hooks/useLocalCommands.ts.

export function readMemory(
  ...args: Parameters<Window["hermesAPI"]["readMemory"]>
): ReturnType<Window["hermesAPI"]["readMemory"]> {
  return window.hermesAPI.readMemory(...args);
}

export function getMemoryTimeline(
  ...args: Parameters<Window["hermesAPI"]["getMemoryTimeline"]>
): ReturnType<Window["hermesAPI"]["getMemoryTimeline"]> {
  return window.hermesAPI.getMemoryTimeline(...args);
}

export function writeMemory(
  ...args: Parameters<Window["hermesAPI"]["writeMemory"]>
): ReturnType<Window["hermesAPI"]["writeMemory"]> {
  return window.hermesAPI.writeMemory(...args);
}

export function removeMemoryEntry(
  ...args: Parameters<Window["hermesAPI"]["removeMemoryEntry"]>
): ReturnType<Window["hermesAPI"]["removeMemoryEntry"]> {
  return window.hermesAPI.removeMemoryEntry(...args);
}

export function updateMemoryEntry(
  ...args: Parameters<Window["hermesAPI"]["updateMemoryEntry"]>
): ReturnType<Window["hermesAPI"]["updateMemoryEntry"]> {
  return window.hermesAPI.updateMemoryEntry(...args);
}

export function addMemoryEntry(
  ...args: Parameters<Window["hermesAPI"]["addMemoryEntry"]>
): ReturnType<Window["hermesAPI"]["addMemoryEntry"]> {
  return window.hermesAPI.addMemoryEntry(...args);
}

export function writeUserProfile(
  ...args: Parameters<Window["hermesAPI"]["writeUserProfile"]>
): ReturnType<Window["hermesAPI"]["writeUserProfile"]> {
  return window.hermesAPI.writeUserProfile(...args);
}

export function readSoul(
  ...args: Parameters<Window["hermesAPI"]["readSoul"]>
): ReturnType<Window["hermesAPI"]["readSoul"]> {
  return window.hermesAPI.readSoul(...args);
}

export function writeSoul(
  ...args: Parameters<Window["hermesAPI"]["writeSoul"]>
): ReturnType<Window["hermesAPI"]["writeSoul"]> {
  return window.hermesAPI.writeSoul(...args);
}

export function resetSoul(
  ...args: Parameters<Window["hermesAPI"]["resetSoul"]>
): ReturnType<Window["hermesAPI"]["resetSoul"]> {
  return window.hermesAPI.resetSoul(...args);
}

export function readFocus(): ReturnType<Window["hermesAPI"]["readFocus"]> {
  return window.hermesAPI.readFocus();
}

export function writeFocus(
  content: string,
): ReturnType<Window["hermesAPI"]["writeFocus"]> {
  return window.hermesAPI.writeFocus(content);
}

export function discoverMemoryProviders(
  ...args: Parameters<Window["hermesAPI"]["discoverMemoryProviders"]>
): ReturnType<Window["hermesAPI"]["discoverMemoryProviders"]> {
  return window.hermesAPI.discoverMemoryProviders(...args);
}

export function listLearningProposals(
  ...args: Parameters<Window["hermesAPI"]["listLearningProposals"]>
): ReturnType<Window["hermesAPI"]["listLearningProposals"]> {
  return window.hermesAPI.listLearningProposals(...args);
}

export function createLearningProposal(
  ...args: Parameters<Window["hermesAPI"]["createLearningProposal"]>
): ReturnType<Window["hermesAPI"]["createLearningProposal"]> {
  return window.hermesAPI.createLearningProposal(...args);
}

export function acceptLearningProposal(
  ...args: Parameters<Window["hermesAPI"]["acceptLearningProposal"]>
): ReturnType<Window["hermesAPI"]["acceptLearningProposal"]> {
  return window.hermesAPI.acceptLearningProposal(...args);
}

export function dismissLearningProposal(
  ...args: Parameters<Window["hermesAPI"]["dismissLearningProposal"]>
): ReturnType<Window["hermesAPI"]["dismissLearningProposal"]> {
  return window.hermesAPI.dismissLearningProposal(...args);
}
