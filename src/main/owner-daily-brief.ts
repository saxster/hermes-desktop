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

export function dailyBriefPrompt(vaultDir: string): string {
  return [
    "Create the owner's concise 7:00 daily operator brief.",
    `Read the SPS markdown workspace at ${vaultDir} without editing the notes you find there.`,
    "Report: today's and overdue tasks, active follow-up reminders, inbox/triage items awaiting review, pending approvals or proposals, the latest Daily Brief or scheduled-research changes, and any material engine/gateway or equity alerts visible in the workspace.",
    "Use short sections, name the source file paths for actionable items, and end with the three highest-leverage next actions.",
    "If a category has no evidence, say none; never invent status.",
    // The brief is only useful if it lands somewhere the owner can read, search
    // and link it. Delivery alone drops it into a channel once; the page makes
    // it part of the workspace.
    "Then save the finished brief into the workspace by calling the sps_write_page tool.",
    "Use pageId 'daily-brief-YYYY-MM-DD' with today's local date (letters, digits and hyphens only), and pass the whole brief as markdown beginning with a frontmatter block containing title: \"Daily Brief - YYYY-MM-DD\", kind: daily-brief and context: review.",
    "Finish your reply with one line naming the page id you wrote.",
  ].join(" ");
}

export async function syncOwnerDailyBriefCron(
  profile?: string,
  dependencies: DailyBriefCronDependencies = defaultDependencies,
): Promise<{
  success: boolean;
  action: "created" | "updated" | "paused" | "resumed" | "unchanged";
  error?: string;
}> {
  const settings = getOwnerDeliverySettings(profile);
  const jobs = await dependencies.list(true, profile);
  const existing = jobs.find((job) => job.name === OWNER_DAILY_BRIEF_JOB_NAME);

  if (!settings.events["daily-brief"]) {
    if (!existing || existing.state === "paused") {
      return { success: true, action: "unchanged" };
    }
    const paused = await dependencies.pause(existing.id, profile);
    if (!paused.success) {
      throw new Error(paused.error || "Failed to pause owner daily brief cron");
    }
    return { success: true, action: "paused" };
  }

  const deliver = ownerDailyBriefDeliveryTarget(profile, dependencies.now());
  const expectedDelivery = deliver.split(",");
  const expectedPrompt = dailyBriefPrompt(dependencies.vaultDir(profile));
  // The prompt has to take part in the comparison, or an existing job counts as
  // "unchanged" forever and every edit to dailyBriefPrompt is silently dropped.
  // Containment rather than equality because createCronJob may append an
  // "Operating rules:" block via augmentPrompt.
  const matches =
    existing?.schedule === OWNER_DAILY_BRIEF_SCHEDULE &&
    expectedDelivery.every((target) => existing.deliver.includes(target)) &&
    existing.deliver.length === expectedDelivery.length &&
    existing.prompt.includes(expectedPrompt);

  if (existing && matches) {
    if (existing.state === "paused") {
      const resumed = await dependencies.resume(existing.id, profile);
      if (!resumed.success) {
        throw new Error(
          resumed.error || "Failed to resume owner daily brief cron",
        );
      }
      return { success: true, action: "resumed" };
    }
    return { success: true, action: "unchanged" };
  }

  if (existing) {
    const removed = await dependencies.remove(existing.id, profile);
    if (!removed.success) {
      throw new Error(
        removed.error || "Failed to remove outdated owner daily brief cron",
      );
    }
  }

  const created = await dependencies.create(
    OWNER_DAILY_BRIEF_SCHEDULE,
    expectedPrompt,
    OWNER_DAILY_BRIEF_JOB_NAME,
    deliver,
    profile,
  );
  if (!created.success) {
    throw new Error(created.error || "Failed to create owner daily brief cron");
  }
  return { success: true, action: existing ? "updated" : "created" };
}
