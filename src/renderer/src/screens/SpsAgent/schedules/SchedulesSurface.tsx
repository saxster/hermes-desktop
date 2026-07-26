// SchedulesSurface.tsx — every recurring thing the app runs, in one list.
//
// This is the promotion of what was the "Scheduled" tab inside MyWorkSurface:
// same three sources, but a first-class surface, and with the two actions that
// previously existed only behind the Manage modal — run now, and delete. A
// schedule you cannot fire on demand is a schedule you cannot debug, which is
// how a cron job "succeeded" 566 times against a deleted skill without anyone
// noticing.
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { cadenceLabel } from "../../../../../shared/scheduledResearch";
import { appLaunchCadenceLabel } from "../../../../../shared/app-launcher";
import type { CronJob } from "../../../../../shared/cronjobs";
import {
  listCronJobs,
  pauseCronJob,
  removeCronJob,
  resumeCronJob,
  srList,
  srUpdate,
  triggerCronJob,
} from "../../../lib/api/scheduler";
import {
  formatWhen,
  isFailing,
  rowFromCron,
  rowFromLaunch,
  rowFromResearch,
  sortByNextRun,
  type ScheduleRow,
} from "./scheduleModel";

const SOURCE_LABEL: Record<ScheduleRow["source"], string> = {
  monitor: "Topic monitor",
  digest: "External digest",
  launch: "Launch recipe",
  agent: "Agent job",
};

/** Load all three sources and normalize them into one sorted list. Each source
 *  fails independently — one dead subsystem must not blank the whole surface. */
async function loadRows(): Promise<ScheduleRow[]> {
  const [research, launches, crons] = await Promise.all([
    srList().catch(() => []),
    window.hermesAPI.appLaunchListSchedules().catch(() => []),
    listCronJobs(true).catch(() => [] as CronJob[]),
  ]);
  const rows = [
    ...(research || []).map((item) =>
      rowFromResearch(item, cadenceLabel(item.cadence, item.hour)),
    ),
    ...(launches || []).map((item) =>
      rowFromLaunch(item, appLaunchCadenceLabel(item.cadence, item.hour)),
    ),
    ...(crons || []).map(rowFromCron),
  ];
  return sortByNextRun(rows);
}

export function SchedulesSurface(): React.JSX.Element {
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      setRows(await loadRows());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load scheduled items.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch((err: unknown) => {
      console.error("Failed to load schedules:", err);
    });
  }, [refresh]);

  /** Every row action is the same shape: mark busy, act, reload, report.
   *  Returns void and swallows nothing — the chain ends in `.catch`, so a
   *  failing action shows an error rather than an unhandled rejection. */
  function act(
    row: ScheduleRow,
    work: () => Promise<unknown>,
    success?: string,
  ): void {
    setBusyId(row.id);
    setError("");
    setNotice("");
    work()
      .then(() => {
        if (success) setNotice(success);
        return refresh();
      })
      .then(() => setBusyId(""))
      .catch((err: unknown) => {
        setBusyId("");
        setError(
          err instanceof Error ? err.message : `Could not update ${row.label}.`,
        );
      });
  }

  function toggle(row: ScheduleRow): void {
    if (row.source === "agent") {
      const flip = row.state === "paused" ? resumeCronJob : pauseCronJob;
      act(row, () => flip(row.id));
      return;
    }
    if (row.source === "launch") {
      act(row, () =>
        window.hermesAPI.appLaunchUpdateSchedule(row.id, {
          enabled: !row.enabled,
        }),
      );
      return;
    }
    act(row, () => srUpdate(row.id, { enabled: !row.enabled }));
  }

  function runNow(row: ScheduleRow): void {
    act(row, () => triggerCronJob(row.id), `Triggered ${row.label}.`);
  }

  function remove(row: ScheduleRow): void {
    const ok = window.confirm(
      `Delete "${row.label}"? This removes the schedule; anything it already wrote stays in your vault.`,
    );
    if (!ok) return;
    act(row, () => removeCronJob(row.id), `Deleted ${row.label}.`);
  }

  const failing = rows.filter(isFailing);

  return (
    <div className="doc-scroll scroll">
      <div className="work-shell">
        <header className="work-shell-head">
          <div>
            <h1>Schedules</h1>
            <p>
              Everything that runs on its own — topic monitors, launch recipes,
              and agent jobs. Output goes to review before it changes your
              workspace.
            </p>
          </div>
          <button className="cover-btn" onClick={() => setScheduledOpen(true)}>
            <Icon name="clock" size={15} /> New schedule
          </button>
        </header>

        {error && <div className="active-work-error">{error}</div>}
        {notice && (
          <div className="ck-empty" role="status">
            {notice}
          </div>
        )}
        {failing.length > 0 && (
          <div className="active-work-error" role="alert">
            {failing.length === 1
              ? `1 schedule reported a problem on its last run: ${failing[0].label}.`
              : `${failing.length} schedules reported a problem on their last run.`}
          </div>
        )}

        {loading ? (
          <div className="ck-empty">Loading schedules...</div>
        ) : rows.length === 0 ? (
          <div className="ck-empty">
            Nothing is scheduled yet. &ldquo;New schedule&rdquo; sets up a topic
            monitor or a recurring agent job.
          </div>
        ) : (
          <div className="work-rule-list">
            {rows.map((row) => (
              <article
                className="work-rule-row"
                key={`${row.source}:${row.id}`}
              >
                <div className="work-rule-main">
                  <strong>{row.label}</strong>
                  <span>
                    {SOURCE_LABEL[row.source]} · {row.cadence} · last{" "}
                    {formatWhen(row.lastRunAt)}
                    {row.nextRunAt !== null
                      ? ` · next ${formatWhen(row.nextRunAt)}`
                      : ""}
                  </span>
                  <small>
                    {row.state}
                    {row.lastStatus ? ` · ${row.lastStatus}` : ""}
                  </small>
                  {row.lastError && <small>{row.lastError}</small>}
                </div>
                {row.canRunNow && (
                  <button
                    className="cover-btn"
                    disabled={busyId === row.id}
                    onClick={() => runNow(row)}
                    aria-label={`Run ${row.label} now`}
                  >
                    Run now
                  </button>
                )}
                {row.state !== "completed" && (
                  <button
                    className="cover-btn"
                    disabled={busyId === row.id}
                    onClick={() => toggle(row)}
                    aria-label={`${row.enabled && row.state === "active" ? "Pause" : "Resume"} ${row.label}`}
                  >
                    {row.enabled && row.state === "active" ? "Pause" : "Resume"}
                  </button>
                )}
                {row.canDelete && (
                  <button
                    className="cover-btn"
                    disabled={busyId === row.id}
                    onClick={() => remove(row)}
                    aria-label={`Delete ${row.label}`}
                  >
                    Delete
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
