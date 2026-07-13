import type { CronJob } from "../shared/cronjobs";
import {
  createCronJob,
  listCronJobs,
  pauseCronJob,
  removeCronJob,
  resumeCronJob,
} from "./cronjobs";
import {
  getOwnerDeliverySettings,
  ownerDeliveryQuietHoursActive,
} from "./owner-delivery";
import { resolveSpsVaultDir } from "./sps-storage";

export const OWNER_DAILY_BRIEF_JOB_NAME = "sps-owner-daily-brief";
export const OWNER_DAILY_BRIEF_SCHEDULE = "0 7 * * *";

interface DailyBriefCronDependencies {
  list: (includeDisabled: boolean, profile?: string) => Promise<CronJob[]>;
  create: typeof createCronJob;
  pause: typeof pauseCronJob;
  resume: typeof resumeCronJob;
  remove: typeof removeCronJob;
  vaultDir: (profile?: string) => string;
  now: () => Date;
}

const defaultDependencies: DailyBriefCronDependencies = {
  list: listCronJobs,
  create: createCronJob,
  pause: pauseCronJob,
  resume: resumeCronJob,
  remove: removeCronJob,
  vaultDir: resolveSpsVaultDir,
  now: () => new Date(),
};

export function ownerDailyBriefDeliveryTarget(
  profile?: string,
  at = new Date(),
): string {
  const settings = getOwnerDeliverySettings(profile);
  const atSeven = new Date(at);
  atSeven.setHours(7, 0, 0, 0);
  if (ownerDeliveryQuietHoursActive(settings, atSeven)) return "local";

  const targets = ["local"];
  if (settings.channels.telegram) targets.push("telegram");
  if (settings.channels.email) targets.push("email");
  return targets.join(",");
}

function dailyBriefPrompt(vaultDir: string): string {
  return [
    "Create the owner's concise 7:00 daily operator brief.",
    `Read the SPS markdown workspace at ${vaultDir} without modifying it.`,
    "Report: today's and overdue tasks, active follow-up reminders, inbox/triage items awaiting review, pending approvals or proposals, the latest Daily Brief or scheduled-research changes, and any material engine/gateway or equity alerts visible in the workspace.",
    "Use short sections, name the source file paths for actionable items, and end with the three highest-leverage next actions.",
    "If a category has no evidence, say none; never invent status.",
  ].join(" ");
}

export async function syncOwnerDailyBriefCron(
  profile?: string,
  dependencies: DailyBriefCronDependencies = defaultDependencies,
): Promise<{ success: boolean; action: "created" | "updated" | "paused" | "resumed" | "unchanged"; error?: string }> {
  const settings = getOwnerDeliverySettings(profile);
  const jobs = await dependencies.list(true, profile);
  const existing = jobs.find((job) => job.name === OWNER_DAILY_BRIEF_JOB_NAME);

  if (!settings.events["daily-brief"]) {
    if (!existing || existing.state === "paused") {
      return { success: true, action: "unchanged" };
    }
    const paused = await dependencies.pause(existing.id, profile);
    return paused.success
      ? { success: true, action: "paused" }
      : { success: false, action: "paused", error: paused.error };
  }

  const deliver = ownerDailyBriefDeliveryTarget(profile, dependencies.now());
  const expectedDelivery = deliver.split(",");
  const matches =
    existing?.schedule === OWNER_DAILY_BRIEF_SCHEDULE &&
    expectedDelivery.every((target) => existing.deliver.includes(target)) &&
    existing.deliver.length === expectedDelivery.length;

  if (existing && matches) {
    if (existing.state === "paused") {
      const resumed = await dependencies.resume(existing.id, profile);
      return resumed.success
        ? { success: true, action: "resumed" }
        : { success: false, action: "resumed", error: resumed.error };
    }
    return { success: true, action: "unchanged" };
  }

  if (existing) {
    const removed = await dependencies.remove(existing.id, profile);
    if (!removed.success) {
      return { success: false, action: "updated", error: removed.error };
    }
  }

  const created = await dependencies.create(
    OWNER_DAILY_BRIEF_SCHEDULE,
    dailyBriefPrompt(dependencies.vaultDir(profile)),
    OWNER_DAILY_BRIEF_JOB_NAME,
    deliver,
    profile,
  );
  return created.success
    ? { success: true, action: existing ? "updated" : "created" }
    : {
        success: false,
        action: existing ? "updated" : "created",
        error: created.error,
      };
}

