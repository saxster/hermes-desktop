// ResearchModal.tsx — research ANY topic and file it into the Knowledge Base.
//
// Primary mode ("Any topic"): the user types any subject; the Hermes agent
// researches it on the live web (streaming, tool-using turn via runResearch),
// then a synthesized, cited page is auto-committed into the wiki (Wiki/) with a
// one-click Undo. Citations are mandatory — a sourceless result is treated as
// "no web access" and is NOT saved (it would otherwise pollute the KB with
// unverified synthesis).
//
// Secondary mode ("Academic papers"): the original OpenAlex scholarly search —
// type a topic, pick a paper, and Hermes saves a plain-language summary under
// Sources/Research. Preserved so the scholar workflow doesn't regress.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "../store";
import { Icon } from "../components/Icon";
import { SpsModal } from "./SpsModal";
import { research, type WorkSummary } from "../research";
import { saveContentIdea } from "../content/contentStudioStorage";
import {
  parseContentSourceUrls,
  type ContentIdea,
} from "../../../lib/content-studio";
import { hasCuratedBriefSources } from "../../../../../shared/curatedBrief";
import { buildDeckInputFromResearch } from "../../../../../shared/deck-studio";
import {
  buildDeckInputFromStudyCardMarkdown,
  enrichStudyCardMarkdown,
  extractTimeSavedLine,
  hasStudyCardSources,
} from "../../../../../shared/study-card";
import {
  describeResearchReachIntent,
  type ResearchReachStatus,
} from "../../../../../shared/research-reach";

type Mode = "research" | "papers" | "study" | "brief" | "card";
type Phase = "idle" | "running" | "done" | "warn" | "error";
type NotebookState = "idle" | "checking" | "working" | "done" | "failed";
type ResearchHistoryEntry = { pageId: string; title: string; savedAt: number };
const RESEARCH_HISTORY_KEY = "sps-research-history-v1";

function loadResearchHistory(): ResearchHistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(RESEARCH_HISTORY_KEY) || "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is ResearchHistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.pageId === "string" &&
        typeof entry.title === "string" &&
        typeof entry.savedAt === "number" &&
        Number.isFinite(entry.savedAt),
    );
  } catch {
    return [];
  }
}

interface NotebookLmMcpStatus {
  registered: boolean;
  alreadyPresent: boolean;
  commandFound: boolean;
  command: string;
  args: string[];
  source: "env" | "user-bin" | "path" | "claude-code" | "existing";
  nlmCommand: string | null;
  restarted: boolean;
  message: string;
}

function ResearchFrame({
  embedded,
  busy,
  onClose,
  headerActions,
  children,
}: {
  embedded: boolean;
  busy: boolean;
  onClose: () => void;
  headerActions: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  if (!embedded) {
    return (
      <SpsModal
        title="Research"
        onClose={onClose}
        width={640}
        closeGuard={() => !busy}
        headerActions={headerActions}
      >
        {children}
      </SpsModal>
    );
  }
  return (
    <main className="research-workspace" aria-label="Research workspace">
      <header className="research-workspace-head">
        <div>
          <h1>Research</h1>
          <p>Search, study, and revisit source-grounded work.</p>
        </div>
        {headerActions}
      </header>
      {children}
    </main>
  );
}

export function ResearchModal({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const setResearchOpen = useStore((s) => s.setResearchOpen);
  const setScheduledOpen = useStore((s) => s.setScheduledOpen);
  const setScheduledDraftTopic = useStore((s) => s.setScheduledDraftTopic);
  const importResearchWork = useStore((s) => s.importResearchWork);
  const runResearch = useStore((s) => s.runResearch);
  const saveStudyToWiki = useStore((s) => s.saveStudyToWiki);
  const flash = useStore((s) => s.flash);
  const openContentStudioIdea = useStore((s) => s.openContentStudioIdea);
  const openDeckStudioInput = useStore((s) => s.openDeckStudioInput);
  const selectPage = useStore((s) => s.selectPage);
  const setSurface = useStore((s) => s.setSurface);
  const onClose = () => setResearchOpen(false);

  const [mode, setMode] = useState<Mode>("research");
  const [history, setHistory] = useState<ResearchHistoryEntry[]>(
    loadResearchHistory,
  );

  // ── general topic research ──
  const [topic, setTopic] = useState("");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "google" | "social" | "substack"
  >("all");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(""); // streamed markdown preview
  const [toolNote, setToolNote] = useState<string | null>(null);
  const [reachStatus, setReachStatus] = useState<ResearchReachStatus | null>(
    null,
  );
  const [resultSummary, setResultSummary] = useState("");
  const [resultPageId, setResultPageId] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState(""); // warn / error text
  const undoRef = useRef<null | (() => void)>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  // ── web-tool preflight (the load-bearing capability) ──
  // null = unknown (don't block); true/false = known state.
  const [webEnabled, setWebEnabled] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);

  // ── OpenAlex paper search (secondary "Academic papers" mode) ──
  const [q, setQ] = useState("");
  const [results, setResults] = useState<WorkSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mailto, setMailto] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  // Guards against an earlier slow search overwriting a later one.
  const reqSeq = useRef(0);

  // ── source-study mode (corpus grounded in Wiki and optional NotebookLM MCP) ──
  const [studyFocus, setStudyFocus] = useState("");
  const [studyCorpus, setStudyCorpus] = useState("");
  const [studyBusy, setStudyBusy] = useState(false);
  const [studySaving, setStudySaving] = useState(false);
  const [studyResult, setStudyResult] = useState("");
  const [studySaveMsg, setStudySaveMsg] = useState("");
  const [notebookState, setNotebookState] = useState<NotebookState>("idle");
  const [notebookStatus, setNotebookStatus] =
    useState<NotebookLmMcpStatus | null>(null);
  const studyUndoRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    topicRef.current?.focus();
    // Make OpenAlex callable by the Hermes agent (idempotent) — it's one of the
    // sources the research turn can use.
    void window.hermesAPI?.spsResearchEnsureAgentTool?.();
    // Preflight: is the `web` toolset enabled? If the call fails or the toolset
    // is unknown, don't block (treat as enabled) — the no-sources guard still
    // catches a genuinely web-less run after the fact.
    void window.hermesAPI
      ?.getToolsets?.()
      .then((ts) => {
        const web = ts?.find((t) => t.key === "web");
        setWebEnabled(web ? web.enabled : true);
      })
      .catch(() => setWebEnabled(true));
    void window.hermesAPI
      ?.getResearchReachStatus?.()
      .then((status) => {
        setReachStatus(status ?? null);
      })
      .catch(() => undefined);
    // OpenAlex polite-pool / api-key config (key never round-trips — only a flag).
    void window.hermesAPI?.spsResearchGetConfig?.().then((cfg) => {
      if (!cfg) return;
      setMailto(cfg.mailto || "");
      setHasApiKey(!!cfg.hasApiKey);
    });
    setNotebookState("checking");
    void window.hermesAPI
      ?.spsNotebookLmStatus?.()
      .then((status) => {
        setNotebookStatus(status ?? null);
        setNotebookState(status?.registered ? "done" : "idle");
      })
      .catch(() => setNotebookState("idle"));
  }, []);

  const enableWeb = async () => {
    setEnabling(true);
    try {
      await window.hermesAPI?.setToolsetEnabled?.("web", true);
      // browser too — richer page fetching for the same research turn.
      await window.hermesAPI?.setToolsetEnabled?.("browser", true);
      setWebEnabled(true);
    } finally {
      setEnabling(false);
    }
  };

  // "Schedule this topic" → prefill the topic monitor creator. The monitor is
  // only created after the user reviews cadence, sources, and push settings.
  const onScheduleThis = async () => {
    const t = topic.trim();
    if (!t) return;
    setScheduledDraftTopic(t);
    setResearchOpen(false);
    setScheduledOpen(true);
  };

  const doResearch = async () => {
    const t = topic.trim();
    if (!t || phase === "running") return;
    setPhase("running");
    setProgress("");
    setToolNote(null);
    setResultMsg("");
    setResultSummary("");
    setResultPageId(null);
    undoRef.current = null;

    let finalQuery = t;
    if (sourceFilter === "social") {
      finalQuery = `Focusing on discussions on Reddit, Twitter, and Facebook, research: ${t}`;
    } else if (sourceFilter === "substack") {
      finalQuery = `Focusing on Substack, newsletters, and blogs, research: ${t}`;
    } else if (sourceFilter === "google") {
      finalQuery = `Using Google search engine, research: ${t}`;
    }

    const res = await runResearch(
      finalQuery,
      {
        onChunk: (md) => setProgress(md),
        onTool: (tool) => setToolNote(tool),
      },
      sourceFilter,
    );
    if (res.ok) {
      setPhase("done");
      setResultSummary(res.summary || t);
      setResultPageId(res.pageId ?? null);
      undoRef.current = res.undo ?? null;
      if (res.pageId) {
        const next = [
          { pageId: res.pageId, title: res.summary || t, savedAt: Date.now() },
          ...history.filter((entry) => entry.pageId !== res.pageId),
        ].slice(0, 8);
        setHistory(next);
        localStorage.setItem(RESEARCH_HISTORY_KEY, JSON.stringify(next));
      }
      flash("Saved to your Knowledge Base");
    } else if (res.error === "no-sources" || res.error === "no-result") {
      setPhase("warn");
      setResultMsg(
        "My Assistant couldn't gather web sources for this topic, so nothing was saved. " +
          "Check that a web-search-capable provider is configured for Connections, then try again.",
      );
    } else {
      setPhase("error");
      setResultMsg(res.error || "Research failed.");
    }
  };

  const undo = () => {
    undoRef.current?.();
    undoRef.current = null;
    if (resultPageId) {
      const next = history.filter((entry) => entry.pageId !== resultPageId);
      setHistory(next);
      localStorage.setItem(RESEARCH_HISTORY_KEY, JSON.stringify(next));
    }
    setPhase("idle");
    setProgress("");
    setResultSummary("");
    setResultPageId(null);
    flash("Removed from Knowledge Base");
  };

  const openSavedResearch = (): void => {
    if (!resultPageId) return;
    selectPage(resultPageId);
    setSurface("doc");
    if (!embedded) onClose();
  };

  const resetResearch = () => {
    setPhase("idle");
    setProgress("");
    setToolNote(null);
    setResultMsg("");
    setResultSummary("");
    setResultPageId(null);
    undoRef.current = null;
  };

  const saveConfig = async () => {
    setSavingCfg(true);
    try {
      const apiKeyArg = apiKeyInput.trim() ? apiKeyInput.trim() : undefined;
      const cfg = await window.hermesAPI?.spsResearchSetConfig?.(
        mailto.trim(),
        apiKeyArg,
      );
      if (cfg) {
        setMailto(cfg.mailto || "");
        setHasApiKey(!!cfg.hasApiKey);
      }
      setApiKeyInput("");
      setSettingsOpen(false);
    } finally {
      setSavingCfg(false);
    }
  };

  const runSearch = async () => {
    const query = q.trim();
    if (!query) return;
    const seq = ++reqSeq.current;
    setLoading(true);
    setSearched(true);
    try {
      const hits = await research.searchWorks(query, { perPage: 20 });
      if (seq === reqSeq.current) setResults(hits);
    } catch {
      if (seq === reqSeq.current) setResults([]);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  const savePaper = async (w: WorkSummary) => {
    setSavingId(w.id);
    try {
      const detail = await research.getWork(w.id);
      await importResearchWork(detail);
      onClose();
    } finally {
      setSavingId(null);
    }
  };

  const enableNotebookLm = async () => {
    setNotebookState("working");
    try {
      const res = await window.hermesAPI?.spsNotebookLmEnsureMcp?.();
      setNotebookStatus(res ?? null);
      setNotebookState(res?.registered ? "done" : "failed");
    } catch {
      setNotebookState("failed");
    }
  };

  const runSourceStudy = async () => {
    const focus = studyFocus.trim();
    if (!focus || studyBusy) return;
    setStudyBusy(true);
    setStudyResult("");
    setStudySaveMsg("");
    studyUndoRef.current = null;
    try {
      const res = await window.hermesAPI?.spsSourceStudy?.(
        focus,
        studyCorpus.trim() || undefined,
      );
      const reply = extractChatReply(res);
      setStudyResult(reply || "No study result returned.");
    } catch (err) {
      setStudyResult(
        err instanceof Error ? err.message : "Source study failed.",
      );
    } finally {
      setStudyBusy(false);
    }
  };

  const runCuratedBrief = async () => {
    const focus = studyFocus.trim();
    if (!focus || studyBusy) return;
    setStudyBusy(true);
    setStudyResult("");
    setStudySaveMsg("");
    studyUndoRef.current = null;
    try {
      const res = await window.hermesAPI?.spsCuratedBrief?.(
        focus,
        studyCorpus.trim() || undefined,
      );
      const reply = extractChatReply(res);
      setStudyResult(reply || "No curated brief returned.");
    } catch (err) {
      setStudyResult(
        err instanceof Error ? err.message : "Curated brief failed.",
      );
    } finally {
      setStudyBusy(false);
    }
  };

  const runStudyCard = async () => {
    const focus = studyFocus.trim();
    if (!focus || studyBusy) return;
    setStudyBusy(true);
    setStudyResult("");
    setStudySaveMsg("");
    studyUndoRef.current = null;
    try {
      const res = await window.hermesAPI?.spsStudyCard?.(
        focus,
        studyCorpus.trim() || undefined,
      );
      const reply = extractChatReply(res);
      const raw = reply || "No study card returned.";
      setStudyResult(enrichStudyCardMarkdown(raw));
    } catch (err) {
      setStudyResult(err instanceof Error ? err.message : "Study card failed.");
    } finally {
      setStudyBusy(false);
    }
  };

  const saveStudy = async () => {
    if (!studyResult.trim() || studySaving) return;
    if (mode === "brief" && !hasCuratedBriefSources(studyResult)) {
      setStudySaveMsg(
        "Could not find usable source links, so nothing was saved.",
      );
      return;
    }
    if (mode === "card" && !hasStudyCardSources(studyResult)) {
      setStudySaveMsg(
        "Could not find usable source links, so nothing was saved.",
      );
      return;
    }
    setStudySaving(true);
    setStudySaveMsg("");
    try {
      const res = await saveStudyToWiki(studyFocus.trim(), studyResult);
      if (res.ok) {
        studyUndoRef.current = res.undo ?? null;
        setStudySaveMsg(res.summary || "Saved to your Knowledge Base.");
        flash(
          mode === "card"
            ? "Saved study card to your Knowledge Base"
            : "Saved study to your Knowledge Base",
        );
      } else {
        setStudySaveMsg(res.error || "Filing unavailable.");
      }
    } finally {
      setStudySaving(false);
    }
  };

  const saveResearchAsContentIdea = async (): Promise<void> => {
    const title = topic.trim() || studyFocus.trim();
    if (!title) return;
    const sourceUrls =
      mode === "brief" || mode === "card" || mode === "study"
        ? parseContentSourceUrls(`${studyCorpus}\n${studyResult}`)
        : [];
    const date = new Date().toISOString().slice(0, 10);
    const capturedFrom =
      mode === "brief"
        ? "curated-brief"
        : mode === "card"
          ? "study-card"
          : mode === "study"
            ? "source-study"
            : "research-reach";
    const idea: ContentIdea = {
      id: `idea-research-${Date.now().toString(36)}`,
      title,
      sourceUrls,
      audience: "",
      angle:
        resultSummary || progress || studyResult || "Captured from Research.",
      createdAt: date,
      updatedAt: date,
      status: "captured",
      capturedFrom,
      rubric: {
        bookmarkability: 0,
        proof:
          sourceUrls.length || resultSummary || progress || studyResult ? 1 : 0,
        immediateUse: 0,
        audienceClarity: 0,
        reproducibility: 0,
        hookStrength: 0,
        originality: 1,
      },
    };
    await saveContentIdea(idea);
    openContentStudioIdea(idea);
    flash("Saved research as a Content Studio idea.");
  };

  const openResearchDeck = (): void => {
    const title = topic.trim() || studyFocus.trim();
    const markdown = progress || resultSummary || studyResult;
    if (!title || !markdown.trim()) return;
    if (mode === "card") {
      openDeckStudioInput(buildDeckInputFromStudyCardMarkdown(title, markdown));
      setResearchOpen(false);
      flash("Opened Deck Studio with this study card.");
      return;
    }
    const locator =
      mode === "study"
        ? "Research / Study sources"
        : mode === "brief"
          ? "Research / Curated brief"
          : "Research";
    openDeckStudioInput(
      buildDeckInputFromResearch({
        title,
        markdown,
        locator,
      }),
    );
    setResearchOpen(false);
    flash("Opened Deck Studio with this research.");
  };

  const undoStudySave = () => {
    studyUndoRef.current?.();
    studyUndoRef.current = null;
    setStudySaveMsg("");
    flash("Removed from Knowledge Base");
  };

  const busy = phase === "running" || studyBusy || studySaving;
  const researchBusy = phase === "running";
  const sourceReadiness = describeResearchReachIntent(
    reachStatus,
    sourceFilter,
  );
  const notebookBusy =
    notebookState === "checking" || notebookState === "working";
  const notebookCanEnable =
    !notebookBusy && notebookStatus?.commandFound !== false;
  const notebookReady =
    notebookStatus?.registered === true && notebookStatus.commandFound;
  const notebookDetail =
    notebookStatus?.message ||
    (notebookState === "checking"
      ? "Checking NotebookLM MCP setup."
      : "NotebookLM can connect through the local MCP server.");
  const notebookRecovery = notebookStatus?.commandFound
    ? `If Google auth has expired, run ${notebookStatus.nlmCommand || "nlm"} login and try again.`
    : "Install notebooklm-mcp-cli, make notebooklm-mcp available on PATH, or ask IT to set HERMES_NOTEBOOKLM_MCP_COMMAND.";
  const sourceMode = mode === "study" || mode === "brief" || mode === "card";
  const briefMode = mode === "brief";
  const cardMode = mode === "card";
  const studyCardTimeLine =
    cardMode && studyResult ? extractTimeSavedLine(studyResult) : null;

  return (
    <ResearchFrame
      embedded={embedded}
      busy={busy}
      onClose={onClose}
      headerActions={
        <div className="res-header-actions">
          <button
            className={`pal-chip${mode === "research" ? " on" : ""}`}
            onClick={() => setMode("research")}
            disabled={busy}
          >
            Any topic
          </button>
          <button
            className={`pal-chip${mode === "papers" ? " on" : ""}`}
            onClick={() => setMode("papers")}
            disabled={busy}
          >
            Academic papers
          </button>
          <button
            className={`pal-chip${mode === "study" ? " on" : ""}`}
            onClick={() => setMode("study")}
            disabled={busy}
          >
            Study sources
          </button>
          <button
            className={`pal-chip${mode === "brief" ? " on" : ""}`}
            onClick={() => setMode("brief")}
            disabled={busy}
          >
            Curated brief
          </button>
          <button
            className={`pal-chip${mode === "card" ? " on" : ""}`}
            onClick={() => setMode("card")}
            disabled={busy}
          >
            Study card
          </button>
        </div>
      }
    >
      <div className="modal-body">
        {embedded && phase === "idle" && (
          <section className="research-history" aria-labelledby="research-history-title">
            <h2 id="research-history-title">Recent research</h2>
            {history.length === 0 ? (
              <p className="research-history-empty">
                Completed research will appear here for quick return.
              </p>
            ) : <div className="research-history-list">
              {history.map((entry) => (
                <button
                  key={entry.pageId}
                  type="button"
                  onClick={() => {
                    selectPage(entry.pageId);
                    setSurface("doc");
                  }}
                >
                  <span>{entry.title}</span>
                  <time dateTime={new Date(entry.savedAt).toISOString()}>
                    {new Date(entry.savedAt).toLocaleDateString()}
                  </time>
                </button>
              ))}
            </div>}
          </section>
        )}
        {mode === "research" ? (
          <>
            {webEnabled === false && (
              <div className="res-web-alert-box">
                <small className="res-small-label">
                  Web research is off. Enable My Assistant&apos;s web tools to
                  research live topics.
                </small>
                <button
                  className="cover-btn res-flex-shrink-0"
                  onClick={() => void enableWeb()}
                  disabled={enabling}
                >
                  {enabling ? "Enabling…" : "Enable web research"}
                </button>
              </div>
            )}

            <div className="pal-input res-margin-bottom-12">
              <Icon name="search" size={18} className="res-small-label" />
              <input
                ref={topicRef}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doResearch();
                }}
                placeholder="Research any topic — markets, legal, code, Google, socials..."
                disabled={researchBusy}
              />
              <button
                className="cover-btn"
                onClick={() => void doResearch()}
                disabled={researchBusy || !topic.trim() || webEnabled === false}
              >
                {researchBusy ? "Researching…" : "Research"}
              </button>
              <button
                className="cover-btn"
                title="Create a scheduled topic monitor"
                disabled={researchBusy || !topic.trim()}
                onClick={() => void onScheduleThis()}
              >
                <Icon name="clock" size={14} /> Schedule
              </button>
            </div>

            {/* Target search filter toggles */}
            <div className="res-filter-row">
              <span className="res-social-source-title">Target Source:</span>
              <button
                type="button"
                className={`pal-chip${sourceFilter === "all" ? " on" : ""}`}
                onClick={() => setSourceFilter("all")}
                disabled={researchBusy}
              >
                All Web
              </button>
              <button
                type="button"
                className={`pal-chip${sourceFilter === "google" ? " on" : ""}`}
                onClick={() => setSourceFilter("google")}
                disabled={researchBusy}
              >
                Google
              </button>
              <button
                type="button"
                className={`pal-chip${sourceFilter === "social" ? " on" : ""}`}
                onClick={() => setSourceFilter("social")}
                disabled={researchBusy}
              >
                Socials & Reddit
              </button>
              <button
                type="button"
                className={`pal-chip${sourceFilter === "substack" ? " on" : ""}`}
                onClick={() => setSourceFilter("substack")}
                disabled={researchBusy}
              >
                Substack & Blogs
              </button>
            </div>

            {sourceReadiness.message && (
              <small className="res-status-label">
                {sourceReadiness.message}
              </small>
            )}

            {phase === "idle" && (
              <div className="cmts-empty res-idle-message">
                My Assistant researches the topic on the live web, then saves a
                synthesized, cited page into your Knowledge Base — with one
                click to undo.
              </div>
            )}

            {(researchBusy || (phase !== "idle" && !!progress)) && (
              <>
                {researchBusy && (
                  <small className="res-status-label">
                    {toolNote
                      ? `Researching · ${toolNote}…`
                      : "Researching the web…"}
                  </small>
                )}
                {!!progress && (
                  <div className="scroll res-progress-box">{progress}</div>
                )}
              </>
            )}

            {phase === "done" && (
              <div className="res-save-card">
                <div className="res-min-width-0">
                  <div className="c-name">✓ Saved to your Knowledge Base</div>
                  {resultSummary && (
                    <small className="res-small-label">{resultSummary}</small>
                  )}
                </div>
                <div className="res-header-actions res-flex-shrink-0">
                  <button className="cover-btn" onClick={() => undo()}>
                    Undo
                  </button>
                  <button
                    className="cover-btn"
                    onClick={openSavedResearch}
                    disabled={!resultPageId}
                  >
                    Open
                  </button>
                  <button
                    className="cover-btn"
                    onClick={() => void saveResearchAsContentIdea()}
                  >
                    Save as content idea
                  </button>
                  <button className="cover-btn" onClick={openResearchDeck}>
                    Deck from research
                  </button>
                </div>
              </div>
            )}

            {(phase === "warn" || phase === "error") && (
              <div className="res-save-card">
                <small className="res-small-label">{resultMsg}</small>
                <button
                  className="cover-btn res-flex-shrink-0"
                  onClick={resetResearch}
                >
                  Try again
                </button>
              </div>
            )}
          </>
        ) : sourceMode ? (
          <>
            <div className="res-web-alert-box">
              <small className="res-small-label">
                {notebookDetail} Source: {notebookSourceLabel(notebookStatus)}.
                Google auth stays outside this app.
                {notebookStatus?.restarted
                  ? " My Assistant was restarted so the tool can load."
                  : ""}
              </small>
              <button
                className="cover-btn res-flex-shrink-0"
                onClick={() => void enableNotebookLm()}
                disabled={
                  notebookState === "working" ||
                  notebookState === "checking" ||
                  !notebookCanEnable ||
                  notebookReady
                }
              >
                {notebookState === "checking"
                  ? "Checking..."
                  : notebookState === "working"
                    ? "Enabling..."
                    : notebookReady
                      ? "NotebookLM enabled"
                      : "Enable NotebookLM"}
              </button>
            </div>

            {(notebookState === "failed" ||
              notebookStatus?.commandFound === false) && (
              <div className="res-web-alert-box">
                <small className="res-small-label">{notebookRecovery}</small>
              </div>
            )}

            <div className="pal-input res-margin-bottom-12">
              <Icon name="search" size={18} className="res-small-label" />
              <input
                value={studyFocus}
                onChange={(e) => setStudyFocus(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (briefMode) void runCuratedBrief();
                    else if (cardMode) void runStudyCard();
                    else void runSourceStudy();
                  }
                }}
                placeholder={
                  briefMode
                    ? "Topic or decision..."
                    : cardMode
                      ? "Video, article, or source to distill..."
                      : "Question or learning goal..."
                }
                disabled={studyBusy}
              />
              <button
                className="cover-btn"
                onClick={() => {
                  if (briefMode) void runCuratedBrief();
                  else if (cardMode) void runStudyCard();
                  else void runSourceStudy();
                }}
                disabled={studyBusy || !studyFocus.trim()}
              >
                {studyBusy
                  ? briefMode
                    ? "Writing..."
                    : cardMode
                      ? "Distilling..."
                      : "Studying..."
                  : briefMode
                    ? "Generate brief"
                    : cardMode
                      ? "Distill card"
                      : "Study"}
              </button>
            </div>

            <label className="res-corpus-label">
              Corpus description
              <textarea
                value={studyCorpus}
                onChange={(e) => setStudyCorpus(e.target.value)}
                placeholder={
                  cardMode
                    ? "Paste a YouTube URL, transcript, or source set to distill into a scannable study card."
                    : "Optional: name the PDFs, videos, articles, wiki pages, or NotebookLM notebooks to study."
                }
                disabled={studyBusy}
                rows={3}
                className="res-study-textarea"
                title="Corpus description"
              />
            </label>

            {!studyResult && !studyBusy && (
              <div className="cmts-empty res-idle-message">
                {briefMode
                  ? "Build a source-grounded pre-writing brief with perspectives, questions, an evidence ledger, outline, concept links, and open questions."
                  : cardMode
                    ? "Distill long media into a vault-native study card: big takeaway, thematic sections, timestamped quotes, time saved, and sources."
                    : "Study connected sources as a corpus: central argument, mental models, disagreements, weak evidence, checks for understanding, and a wiki-ready capture."}
              </div>
            )}

            {!!studyResult && (
              <>
                {studyCardTimeLine && (
                  <small
                    className="res-status-label"
                    data-testid="study-card-time-saved"
                  >
                    {studyCardTimeLine}
                  </small>
                )}
                <div className="scroll res-study-result-box">{studyResult}</div>
                <div className="res-save-card">
                  <small className="res-small-label">{studySaveMsg}</small>
                  <div className="res-header-actions res-flex-shrink-0">
                    {studyUndoRef.current && (
                      <button className="cover-btn" onClick={undoStudySave}>
                        Undo
                      </button>
                    )}
                    <button
                      className="cover-btn"
                      onClick={() => void saveStudy()}
                      disabled={studySaving}
                    >
                      {studySaving ? "Saving..." : "Save to wiki"}
                    </button>
                    <button
                      className="cover-btn"
                      onClick={() => void saveResearchAsContentIdea()}
                    >
                      Save as content idea
                    </button>
                    <button className="cover-btn" onClick={openResearchDeck}>
                      {briefMode
                        ? "Deck from brief"
                        : cardMode
                          ? "Deck from study card"
                          : "Deck from study"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="res-settings-row">
              <button
                className="cover-btn"
                onClick={() => setSettingsOpen((v) => !v)}
                title="Polite pool email & API key"
              >
                ⚙ Settings
              </button>
            </div>

            {settingsOpen && (
              <div className="res-settings-panel">
                <label className="res-settings-label">
                  Contact email — opts into OpenAlex&apos;s faster “polite pool”
                  <div className="pal-input res-margin-top-4">
                    <input
                      type="email"
                      value={mailto}
                      onChange={(e) => setMailto(e.target.value)}
                      placeholder="you@example.com"
                      title="Contact email"
                    />
                  </div>
                </label>
                <label className="res-settings-label">
                  API key (optional) — raises the free daily allowance
                  <div className="pal-input res-margin-top-4">
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={
                        hasApiKey
                          ? "•••••••• set — leave blank to keep"
                          : "OpenAlex API key"
                      }
                      title="API Key"
                    />
                  </div>
                </label>
                <div className="res-settings-footer">
                  <button
                    className="cover-btn"
                    onClick={() => void saveConfig()}
                    disabled={savingCfg}
                  >
                    {savingCfg ? "Saving…" : "Save"}
                  </button>
                </div>
                <small className="res-small-label">
                  Stored locally on this machine. Both are optional — search
                  works without them.
                </small>
              </div>
            )}

            <div className="pal-input res-margin-bottom-12">
              <Icon name="search" size={18} className="res-small-label" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void runSearch();
                }}
                placeholder="Search OpenAlex — topic, title, author…"
                title="Search term"
              />
              <button
                className="cover-btn"
                onClick={() => void runSearch()}
                disabled={loading || !q.trim()}
              >
                {loading ? "Searching…" : "Search"}
              </button>
            </div>

            {!searched && (
              <div className="cmts-empty res-idle-message">
                Search the open catalog of 250M+ scholarly works. Pick a paper
                and My Assistant saves a plain-language summary into your
                workspace.
              </div>
            )}
            {searched && !loading && results.length === 0 && (
              <div className="cmts-empty res-idle-message">
                No papers found for “{q}”.
              </div>
            )}

            <div className="scroll res-paper-list-box">
              {results.map((w) => (
                <div key={w.id} className="lst-row res-paper-row">
                  <div className="res-paper-info-container">
                    <div className="c-name res-white-space-normal">
                      {w.title}
                    </div>
                    <small className="res-small-label">{formatByline(w)}</small>
                  </div>
                  {w.isOA && (
                    <span className="pal-chip on res-oa-chip">OA</span>
                  )}
                  <button
                    className="cover-btn"
                    onClick={() => void savePaper(w)}
                    disabled={savingId !== null}
                  >
                    {savingId === w.id ? "Saving…" : "Save"}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </ResearchFrame>
  );
}

function extractChatReply(res: unknown): string {
  if (!res || typeof res !== "object") return "";
  const reply = (res as { reply?: unknown }).reply;
  if (!Array.isArray(reply)) return "";
  return reply.map((x) => String(x)).join("\n\n");
}

function notebookSourceLabel(status: NotebookLmMcpStatus | null): string {
  if (!status) return "Checking local NotebookLM MCP setup";
  if (status.source === "env") return "Managed app configuration";
  if (status.source === "claude-code") return "Claude Code MCP config";
  if (status.source === "user-bin") return "~/.local/bin";
  if (status.source === "existing") return "Hermes profile config";
  return "PATH";
}

/** "Authors (3 + et al.) · Year · Venue · N citations" */
function formatByline(w: WorkSummary): string {
  const names = w.authors.slice(0, 3).join(", ");
  const authors = w.authors.length > 3 ? `${names} et al.` : names;
  const citations = `${w.citedByCount} citation${w.citedByCount === 1 ? "" : "s"}`;
  return [authors, w.year ? String(w.year) : null, w.venue, citations]
    .filter(Boolean)
    .join(" · ");
}
