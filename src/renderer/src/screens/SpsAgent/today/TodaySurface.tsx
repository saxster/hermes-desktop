// TodaySurface.tsx — the one screen that answers "what needs me today".
//
// Four things, in the order they matter: what the agent produced overnight
// (the daily brief), what is on me (tasks), what is waiting to be triaged
// (inbox), and what fires next (schedules). Everything here is derived from
// state that already exists — no new IPC channel.
//
// The brief card states plainly when today's brief is MISSING and how stale the
// last one is. That is the whole point: this app's characteristic failure is a
// loop that quietly stops running while every screen still looks fine.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { useStore } from "../store";
import { useVaultQuery } from "../hooks/useNoteIndex";
import { INBOX_FOLDER } from "../inbox/capture";
import { cadenceLabel } from "../../../../../shared/scheduledResearch";
import { appLaunchCadenceLabel } from "../../../../../shared/app-launcher";
import type { CronJob } from "../../../../../shared/cronjobs";
import { listCronJobs, srList } from "../../../lib/api/scheduler";
import {
  formatWhen,
  nextUp,
  rowFromCron,
  rowFromLaunch,
  rowFromResearch,
  type ScheduleRow,
} from "../schedules/scheduleModel";
import { TaskPanel } from "./TaskPanel";
import {
  dailyBriefPageId,
  daysBetween,
  latestBriefDate,
  localDateKey,
  untriagedCount,
} from "./todayModel";

const TASK_PREVIEW_LIMIT = 8;
const NEXT_RUN_LIMIT = 3;

function longDate(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/** The brief card. Reads page ids straight from the store — the engine writes
 *  the brief as a real vault page, so its presence IS the proof the write path
 *  worked last night. */
function BriefCard({ today }: { today: string }): React.JSX.Element {
  const meta = useStore((s) => s.meta);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);

  const pageIds = useMemo(() => Object.keys(meta), [meta]);
  const todayId = dailyBriefPageId(today);
  const hasToday = pageIds.includes(todayId);
  const latest = useMemo(() => latestBriefDate(pageIds), [pageIds]);

  function open(pageId: string): void {
    selectPage(pageId);
    setSurface("doc");
  }

  if (hasToday) {
    return (
      <section className="work-rule-panel" aria-labelledby="today-brief-title">
        <div className="work-rule-head">
          <div>
            <h2 id="today-brief-title">Your brief</h2>
            <p>The agent wrote today&rsquo;s brief.</p>
          </div>
          <button className="cover-btn" onClick={() => open(todayId)}>
            <Icon name="doc" size={15} /> Read it
          </button>
        </div>
      </section>
    );
  }

  const staleDays = latest ? daysBetween(latest, today) : null;
  return (
    <section className="work-rule-panel" aria-labelledby="today-brief-title">
      <div className="work-rule-head">
        <div>
          <h2 id="today-brief-title">Your brief</h2>
          <p>
            {latest === null
              ? "No brief has ever been written."
              : staleDays === 1
                ? "Today's brief has not arrived. The last one was yesterday."
                : `Today's brief has not arrived. The last one was ${staleDays} days ago.`}
          </p>
        </div>
        {latest !== null && (
          <button
            className="cover-btn"
            onClick={() => open(dailyBriefPageId(latest))}
          >
            <Icon name="doc" size={15} /> Read the last one
          </button>
        )}
      </div>
    </section>
  );
}

/** Captures waiting on triage. One number and a way in — the inbox surface
 *  already does the work. */
function InboxCard(): React.JSX.Element | null {
  const setSurface = useStore((s) => s.setSurface);
  const { rows } = useVaultQuery(INBOX_FOLDER);
  const waiting = untriagedCount(rows);
  if (waiting === 0) return null;

  return (
    <section className="work-rule-panel" aria-labelledby="today-inbox-title">
      <div className="work-rule-head">
        <div>
          <h2 id="today-inbox-title">Inbox</h2>
          <p>
            {waiting === 1
              ? "1 capture is waiting to be triaged."
              : `${waiting} captures are waiting to be triaged.`}
          </p>
        </div>
        <button className="cover-btn" onClick={() => setSurface("inbox")}>
          <Icon name="inbox" size={15} /> Open inbox
        </button>
      </div>
    </section>
  );
}

/** The next few runs that will actually fire. */
function NextRunsCard(): React.JSX.Element {
  const setSurface = useStore((s) => s.setSurface);
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const [research, launches, crons] = await Promise.all([
        srList().catch(() => []),
        window.hermesAPI.appLaunchListSchedules().catch(() => []),
        listCronJobs(true).catch(() => [] as CronJob[]),
      ]);
      if (cancelled) return;
      setRows([
        ...(research || []).map((item) =>
          rowFromResearch(item, cadenceLabel(item.cadence, item.hour)),
        ),
        ...(launches || []).map((item) =>
          rowFromLaunch(item, appLaunchCadenceLabel(item.cadence, item.hour)),
        ),
        ...(crons || []).map(rowFromCron),
      ]);
      setLoaded(true);
    }
    load().catch(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const upcoming = useMemo(() => nextUp(rows, NEXT_RUN_LIMIT), [rows]);

  return (
    <section className="work-rule-panel" aria-labelledby="today-next-title">
      <div className="work-rule-head">
        <div>
          <h2 id="today-next-title">Coming up</h2>
          <p>The next scheduled runs.</p>
        </div>
        <button className="cover-btn" onClick={() => setSurface("schedules")}>
          <Icon name="clock" size={15} /> All schedules
        </button>
      </div>
      {!loaded ? (
        <div className="ck-empty">Loading schedules...</div>
      ) : upcoming.length === 0 ? (
        <div className="ck-empty">Nothing is scheduled to run next.</div>
      ) : (
        <div className="work-rule-list">
          {upcoming.map((row) => (
            <article className="work-rule-row" key={`${row.source}:${row.id}`}>
              <div className="work-rule-main">
                <strong>{row.label}</strong>
                <span>{formatWhen(row.nextRunAt)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function TodaySurface(): React.JSX.Element {
  const today = localDateKey();

  return (
    <div className="doc-scroll scroll">
      <div className="work-shell">
        <header className="work-shell-head">
          <div>
            <h1>Today</h1>
            <p>{longDate(today)}</p>
          </div>
        </header>

        <BriefCard today={today} />
        <TaskPanel
          mode="today"
          limit={TASK_PREVIEW_LIMIT}
          heading="Needs attention"
        />
        <InboxCard />
        <NextRunsCard />
      </div>
    </div>
  );
}
