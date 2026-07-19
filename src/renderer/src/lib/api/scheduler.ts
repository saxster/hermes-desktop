// lib/api/scheduler.ts — the renderer's single import seam for recurring
// work: Scheduled Research jobs (sr*, sps bridge) and the Hermes cron jobs
// (system bridge) that ScheduledModal / My Work surface side by side.
//
// Data-access layer: today these are deliberate pass-throughs to
// window.hermesAPI — the value is the SEAM. Components import the domain,
// not the global, so the domain's IPC surface is greppable in one place and
// error normalization / caching / connection-mode branching has exactly one
// home when it becomes needed. New scheduler call sites MUST be added here
// first, then imported. See docs/REFACTOR-AUDIT-2026-07-18.md §2.
//
// Wrappers spread their Parameters<> tuple so a call's arity is forwarded
// exactly — fn(id) reaches the bridge as fn(id), never fn(id, undefined).
// App-launcher schedules (appLaunch*Schedule) are a separate domain and
// stay on the global until lib/api/app-launcher.ts exists.
//
// First migrated consumers: screens/SpsAgent/modals/ScheduledModal.tsx,
// screens/SpsAgent/journal/MyWorkSurface.tsx,
// screens/SpsAgent/equity/EquityResearch.tsx.

// ── Scheduled Research ──

export function srList(
  ...args: Parameters<Window["hermesAPI"]["srList"]>
): ReturnType<Window["hermesAPI"]["srList"]> {
  return window.hermesAPI.srList(...args);
}

export function srListPending(
  ...args: Parameters<Window["hermesAPI"]["srListPending"]>
): ReturnType<Window["hermesAPI"]["srListPending"]> {
  return window.hermesAPI.srListPending(...args);
}

export function srRemovePending(
  ...args: Parameters<Window["hermesAPI"]["srRemovePending"]>
): ReturnType<Window["hermesAPI"]["srRemovePending"]> {
  return window.hermesAPI.srRemovePending(...args);
}

export function srCreate(
  ...args: Parameters<Window["hermesAPI"]["srCreate"]>
): ReturnType<Window["hermesAPI"]["srCreate"]> {
  return window.hermesAPI.srCreate(...args);
}

export function srUpdate(
  ...args: Parameters<Window["hermesAPI"]["srUpdate"]>
): ReturnType<Window["hermesAPI"]["srUpdate"]> {
  return window.hermesAPI.srUpdate(...args);
}

export function srUpdateSourcePlan(
  ...args: Parameters<Window["hermesAPI"]["srUpdateSourcePlan"]>
): ReturnType<Window["hermesAPI"]["srUpdateSourcePlan"]> {
  return window.hermesAPI.srUpdateSourcePlan(...args);
}

export function srDelete(
  ...args: Parameters<Window["hermesAPI"]["srDelete"]>
): ReturnType<Window["hermesAPI"]["srDelete"]> {
  return window.hermesAPI.srDelete(...args);
}

export function srRunNow(
  ...args: Parameters<Window["hermesAPI"]["srRunNow"]>
): ReturnType<Window["hermesAPI"]["srRunNow"]> {
  return window.hermesAPI.srRunNow(...args);
}

export function srDiscoverSources(
  ...args: Parameters<Window["hermesAPI"]["srDiscoverSources"]>
): ReturnType<Window["hermesAPI"]["srDiscoverSources"]> {
  return window.hermesAPI.srDiscoverSources(...args);
}

export function srTelegramStatus(
  ...args: Parameters<Window["hermesAPI"]["srTelegramStatus"]>
): ReturnType<Window["hermesAPI"]["srTelegramStatus"]> {
  return window.hermesAPI.srTelegramStatus(...args);
}

export function onScheduledResearchUpdate(
  ...args: Parameters<Window["hermesAPI"]["onScheduledResearchUpdate"]>
): ReturnType<Window["hermesAPI"]["onScheduledResearchUpdate"]> {
  return window.hermesAPI.onScheduledResearchUpdate(...args);
}

export function getSchedulerSkips(): ReturnType<
  Window["hermesAPI"]["getSchedulerSkips"]
> {
  return window.hermesAPI.getSchedulerSkips();
}

// ── Cron jobs ──

export function listCronJobs(
  ...args: Parameters<Window["hermesAPI"]["listCronJobs"]>
): ReturnType<Window["hermesAPI"]["listCronJobs"]> {
  return window.hermesAPI.listCronJobs(...args);
}

export function createCronJob(
  ...args: Parameters<Window["hermesAPI"]["createCronJob"]>
): ReturnType<Window["hermesAPI"]["createCronJob"]> {
  return window.hermesAPI.createCronJob(...args);
}

export function removeCronJob(
  ...args: Parameters<Window["hermesAPI"]["removeCronJob"]>
): ReturnType<Window["hermesAPI"]["removeCronJob"]> {
  return window.hermesAPI.removeCronJob(...args);
}

export function pauseCronJob(
  ...args: Parameters<Window["hermesAPI"]["pauseCronJob"]>
): ReturnType<Window["hermesAPI"]["pauseCronJob"]> {
  return window.hermesAPI.pauseCronJob(...args);
}

export function resumeCronJob(
  ...args: Parameters<Window["hermesAPI"]["resumeCronJob"]>
): ReturnType<Window["hermesAPI"]["resumeCronJob"]> {
  return window.hermesAPI.resumeCronJob(...args);
}

export function triggerCronJob(
  ...args: Parameters<Window["hermesAPI"]["triggerCronJob"]>
): ReturnType<Window["hermesAPI"]["triggerCronJob"]> {
  return window.hermesAPI.triggerCronJob(...args);
}
