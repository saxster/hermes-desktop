import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { ActiveWorkSurface } from "../activeWork/ActiveWorkSurface";
import { ReviewQueueSurface } from "../review/ReviewQueueSurface";
import { cadenceLabel } from "../../../../../shared/scheduledResearch";
import { appLaunchCadenceLabel } from "../../../../../shared/app-launcher";
import type { CronJob } from "../../../../../shared/cronjobs";
import type { AppLaunchSchedule } from "../../../../../shared/app-launcher";
import type { Task } from "../types";
import { useVaultQuery } from "../hooks/useNoteIndex";
import { vaultRowToTask } from "../tasks/vaultRowToTask";
import { TASKS_DB_FOLDER } from "../tasks/taskStorage";
import { dueDateKey } from "../tasks/taskUtils";

type WorkTab = "today" | "next" | "scheduled" | "delegated" | "review";
type Schedule = Awaited<ReturnType<typeof window.hermesAPI.srList>>[number];

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function taskNeedsAttentionToday(task: Task, today: string): boolean {
  if (["doing", "review", "blocked"].includes(task.status)) return true;
  const due = dueDateKey(task.due, Number(today.slice(0, 4)));
  return Boolean(due && due <= today);
}

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
        window.hermesAPI.srList(),
        window.hermesAPI.appLaunchListSchedules().catch(() => []),
        window.hermesAPI.listCronJobs(true).catch(() => [] as CronJob[]),
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
    void refresh();
  }, []);

  async function toggleSchedule(rule: Schedule): Promise<void> {
    setBusyId(rule.id);
    try {
      await window.hermesAPI.srUpdate(rule.id, { enabled: !rule.enabled });
      await refresh();
    } finally {
      setBusyId("");
    }
  }

  async function toggleCron(job: CronJob): Promise<void> {
    setBusyId(job.id);
    try {
      if (job.state === "paused") await window.hermesAPI.resumeCronJob(job.id);
      else await window.hermesAPI.pauseCronJob(job.id);
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
                  {rule.kind === "digest"
                    ? "External digest"
                    : "Topic monitor"}{" "}
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
                  Launch recipe · {appLaunchCadenceLabel(rule.cadence, rule.hour)} ·
                  last {fmtTime(rule.lastRunAt)}
                </span>
                <small>
                  {rule.runWhenClosed ? "app-open and LaunchAgent" : "app-open"} ·{" "}
                  {rule.enabled ? "enabled" : "paused"}
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

function WorkTaskPanel({
  mode,
}: {
  mode: "today" | "next";
}): React.JSX.Element {
  const setOpenTask = useStore((state) => state.setOpenTask);
  const { rows } = useVaultQuery(TASKS_DB_FOLDER);
  const today = localDateKey();
  const tasks = useMemo(
    () => rows.map(vaultRowToTask).filter((task) => task.status !== "done"),
    [rows],
  );
  const visible = tasks.filter((task) => {
    const isToday = taskNeedsAttentionToday(task, today);
    return mode === "today" ? isToday : !isToday;
  });

  return (
    <section className="work-task-panel" aria-labelledby={`work-${mode}-title`}>
      <div className="work-rule-head">
        <div>
          <h2 id={`work-${mode}-title`}>
            {mode === "today" ? "Today" : "Next"}
          </h2>
          <p>
            {mode === "today"
              ? "In progress, blocked, in review, or due today."
              : "Open tasks without an immediate status or due date."}
          </p>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="work-task-empty">
          {mode === "today" ? "Nothing needs attention today." : "No next tasks queued."}
        </p>
      ) : (
        <ul className="work-task-list">
          {visible.map((task: Task) => (
            <li key={task.id}>
              <button type="button" onClick={() => setOpenTask(task)}>
                <span className={`dot s-${task.status}`} aria-hidden="true" />
                <span>{task.title || "Untitled task"}</span>
                <small>{task.due || task.status.replaceAll("_", " ")}</small>
              </button>
            </li>
          ))}
        </ul>
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
            <p>What needs attention now, what comes next, and work in motion.</p>
          </div>
        </header>
        <div className="work-tabs" role="tablist" aria-label="Work sections">
          {[
            ["today", "Today"],
            ["next", "Next"],
            ["scheduled", "Scheduled"],
            ["delegated", "Delegated"],
            ["review", "Review"],
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

        {tab === "today" && <WorkTaskPanel mode="today" />}
        {tab === "next" && <WorkTaskPanel mode="next" />}
        {tab === "delegated" && <ActiveWorkSurface />}
        {tab === "scheduled" && <WorkScheduledPanel />}
        {tab === "review" && <ReviewQueueSurface profile="default" />}
      </div>
    </div>
  );
}
