import { useEffect, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { ActiveWorkSurface } from "../activeWork/ActiveWorkSurface";
import { ReviewQueueSurface } from "../review/ReviewQueueSurface";
import { TaskPanel } from "../today/TaskPanel";
import { cadenceLabel } from "../../../../../shared/scheduledResearch";
import { appLaunchCadenceLabel } from "../../../../../shared/app-launcher";
import type { CronJob } from "../../../../../shared/cronjobs";
import type { AppLaunchSchedule } from "../../../../../shared/app-launcher";
import {
  listCronJobs,
  pauseCronJob,
  resumeCronJob,
  srList,
  srUpdate,
} from "../../../lib/api/scheduler";

// Both helpers moved to today/todayModel.ts when Today was promoted to its own
// surface — re-exported here so existing importers keep working and there is
// still exactly one implementation.
export { localDateKey, taskNeedsAttentionToday } from "../today/todayModel";

type WorkTab = "today" | "next" | "scheduled" | "delegated" | "review";
type Schedule = Awaited<ReturnType<typeof srList>>[number];

function fmtTime(ms: number): string {
  if (!ms) return "never";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtCronTime(iso: string | null): string {
  if (!iso) return "not scheduled";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function WorkScheduledPanel(): React.JSX.Element {
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [launchSchedules, setLaunchSchedules] = useState<AppLaunchSchedule[]>(
    [],
  );
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function refresh(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const [scheduleRows, launchRows, cronRows] = await Promise.all([
        srList(),
        window.hermesAPI.appLaunchListSchedules().catch(() => []),
        listCronJobs(true).catch(() => [] as CronJob[]),
      ]);
      setSchedules(scheduleRows || []);
      setLaunchSchedules(launchRows || []);
      setCronJobs(cronRows || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load scheduled items.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch((error: unknown) => {
      console.error("Failed to refresh scheduled work:", error);
    });
  }, []);

  async function toggleSchedule(rule: Schedule): Promise<void> {
    setBusyId(rule.id);
    try {
      await srUpdate(rule.id, { enabled: !rule.enabled });
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  async function toggleCron(job: CronJob): Promise<void> {
    setBusyId(job.id);
    try {
      if (job.state === "paused") await resumeCronJob(job.id);
      else await pauseCronJob(job.id);
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  async function toggleLaunchSchedule(rule: AppLaunchSchedule): Promise<void> {
    setBusyId(rule.id);
    try {
      await window.hermesAPI.appLaunchUpdateSchedule(rule.id, {
        enabled: !rule.enabled,
      });
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="work-rule-panel">
      <div className="work-rule-head">
        <div>
          <h2>Scheduled</h2>
          <p>
            Topic monitors and agent jobs stay visible here. New output goes to
            review before it changes your workspace.
          </p>
        </div>
        <button className="cover-btn" onClick={() => setScheduledOpen(true)}>
          <Icon name="clock" size={15} /> Manage scheduled items
        </button>
      </div>

      {error && <div className="active-work-error">{error}</div>}
      {loading ? (
        <div className="ck-empty">Loading scheduled items...</div>
      ) : schedules.length === 0 &&
        launchSchedules.length === 0 &&
        cronJobs.length === 0 ? (
        <div className="ck-empty">No scheduled items are active.</div>
      ) : (
        <div className="work-rule-list">
          {schedules.map((rule) => (
            <article className="work-rule-row" key={rule.id}>
              <div className="work-rule-main">
                <strong>
                  {rule.kind === "digest" ? "External sessions" : rule.topic}
                </strong>
                <span>
                  {rule.kind === "digest" ? "External digest" : "Topic monitor"}{" "}
                  · {cadenceLabel(rule.cadence, rule.hour)} · last{" "}
                  {fmtTime(rule.lastRunAt)}
                </span>
                <small>
                  Next run follows cadence while app scheduling is available ·{" "}
                  {rule.enabled ? "enabled" : "paused"} · review-first
                </small>
              </div>
              <button
                className="cover-btn"
                disabled={busyId === rule.id}
                onClick={() => void toggleSchedule(rule)}
              >
                {rule.enabled ? "Pause" : "Resume"}
              </button>
            </article>
          ))}
          {launchSchedules.map((rule) => (
            <article className="work-rule-row" key={rule.id}>
              <div className="work-rule-main">
                <strong>{rule.label}</strong>
                <span>
                  Launch recipe ·{" "}
                  {appLaunchCadenceLabel(rule.cadence, rule.hour)} · last{" "}
                  {fmtTime(rule.lastRunAt)}
                </span>
                <small>
                  {rule.runWhenClosed ? "app-open and LaunchAgent" : "app-open"}{" "}
                  · {rule.enabled ? "enabled" : "paused"}
                  {rule.lastStatus ? ` · ${rule.lastStatus}` : ""}
                </small>
                {rule.lastError && <small>{rule.lastError}</small>}
              </div>
              <button
                className="cover-btn"
                disabled={busyId === rule.id}
                onClick={() => void toggleLaunchSchedule(rule)}
              >
                {rule.enabled ? "Pause" : "Resume"}
              </button>
            </article>
          ))}
          {cronJobs.map((job) => (
            <article className="work-rule-row" key={job.id}>
              <div className="work-rule-main">
                <strong>{job.name}</strong>
                <span>
                  Agent job · last {fmtCronTime(job.last_run_at)} · next{" "}
                  {fmtCronTime(job.next_run_at)}
                </span>
                <small>{job.state}</small>
              </div>
              {job.state !== "completed" && (
                <button
                  className="cover-btn"
                  disabled={busyId === job.id}
                  onClick={() => void toggleCron(job)}
                >
                  {job.state === "paused" ? "Resume" : "Pause"}
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function MyWorkSurface() {
  const [tab, setTab] = useState<WorkTab>("today");

  return (
    <div className="doc-scroll scroll">
      <div className="work-shell">
        <header className="work-shell-head">
          <div>
            <h1>Work</h1>
            <p>
              What needs attention now, what comes next, and work in motion.
            </p>
          </div>
        </header>
        <div className="work-tabs" role="tablist" aria-label="Work sections">
          {[
            ["today", "Today"],
            ["next", "Next"],
            ["scheduled", "Scheduled"],
            ["delegated", "Delegated"],
            ["review", "Needs Attention"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`work-tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id as WorkTab)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "today" && <TaskPanel mode="today" />}
        {tab === "next" && <TaskPanel mode="next" />}
        {tab === "delegated" && <ActiveWorkSurface />}
        {tab === "scheduled" && <WorkScheduledPanel />}
        {tab === "review" && <ReviewQueueSurface profile="default" />}
      </div>
    </div>
  );
}
