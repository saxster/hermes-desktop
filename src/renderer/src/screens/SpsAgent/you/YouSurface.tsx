// YouSurface.tsx — the in-workspace home for "make the agent feel like yours".
// Brings the personalization controls that previously lived only in the admin
// overlay (focus / persona / durable facts / daily-context hook) into the SPS
// workspace, and adds the structured "How I like things" rules list.
//
// This surface is the SINGLE owner of USER.md while open: persona prose and the
// rules list both derive from one in-memory state and persist through one
// serializer (serializeUserMd), so the two views can never clobber each other.
import { useCallback, useEffect, useState } from "react";
import {
  EditorSection,
  hookStatusText,
  type HookStatus,
  type MemoryFile,
  type SaveResult,
} from "../../Personalization/parts";
import { RulesManager } from "./RulesManager";
import { SoulEditor } from "./SoulEditor";
import { MemoryProviders } from "./MemoryProviders";
import { MemoryTimeline } from "./MemoryTimeline";
import type { MemoryProviderInfo } from "./memoryProviderTypes";
import {
  parseUserMd,
  serializeUserMd,
  type Rule,
} from "../../../../../shared/userMd";
import { useStore } from "../store";
import { pageFromMarkdown } from "../editor/pageMarkdown";
import { blk } from "../lib/ids";
import {
  addMemoryEntry,
  discoverMemoryProviders,
  listLearningProposals,
  readFocus,
  readMemory,
  writeFocus,
  writeMemory,
  writeUserProfile,
} from "../../../lib/api/memory";

type YouView = "how" | "memory" | "advanced";

const RESPONSE_STYLE_PRESETS = [
  {
    id: "direct",
    label: "Direct",
    rule: "Lead with the answer, be concise, and state problems plainly.",
  },
  {
    id: "balanced",
    label: "Balanced",
    rule: "Balance a clear recommendation with the context and tradeoffs that matter.",
  },
  {
    id: "warm",
    label: "Warm",
    rule: "Use an encouraging, conversational tone without padding the answer.",
  },
  {
    id: "analytical",
    label: "Analytical",
    rule: "Show the reasoning structure, assumptions, evidence, and uncertainty.",
  },
] as const;

function initialYouView(): YouView {
  try {
    const stored = window.localStorage.getItem("hermes.personalization.view");
    if (stored === "memory" || stored === "advanced") return stored;
  } catch {
    /* localStorage is best-effort */
  }
  return "how";
}

interface YouSurfaceProps {
  profile?: string;
}

export function YouSurface({
  profile = "default",
}: YouSurfaceProps): React.JSX.Element {
  const [view, setView] = useState<YouView>(initialYouView);
  const [focus, setFocus] = useState("");
  const [prose, setProse] = useState("");
  const [rules, setRules] = useState<Rule[]>([]);
  const [userCharLimit, setUserCharLimit] = useState(2200);
  const [memory, setMemory] = useState<MemoryFile>({
    content: "",
    charLimit: 2200,
  });
  const [hook, setHook] = useState<HookStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hookBusy, setHookBusy] = useState(false);
  const [hookError, setHookError] = useState("");
  const [rulesError, setRulesError] = useState("");
  const [auditing, setAuditing] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [providers, setProviders] = useState<MemoryProviderInfo[]>([]);
  const [memoryProvider, setMemoryProvider] = useState<string | null>(null);
  const [providersAvailable, setProvidersAvailable] = useState(false);
  const [showMemoryProviders, setShowMemoryProviders] = useState(false);
  const [pendingMemoryCount, setPendingMemoryCount] = useState(0);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState("");

  const selectPage = useStore((s) => s.selectPage);
  const makePage = useStore((s) => s.makePage);
  const setSurface = useStore((s) => s.setSurface);

  async function handleRunAudit() {
    setAuditing(true);
    setAuditError("");
    try {
      const res = await window.hermesAPI.runTelosAudit(profile);
      if (!res.success) {
        setAuditError(res.error || "Alignment audit failed.");
      } else if (res.markdown && res.title) {
        const { blocks } = pageFromMarkdown(res.markdown);
        const docBlocks = blocks.length ? blocks : [blk("p", "")];
        const pageId = makePage(
          {
            icon: "🔍",
            title: res.title,
            ingestedAt: Date.now(),
          },
          docBlocks,
          null,
        );
        selectPage(pageId);
        setSurface("doc");
      } else {
        setAuditError("Audit failed to generate content.");
      }
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Audit failed.");
    } finally {
      setAuditing(false);
    }
  }

  // The optional external memory backend is local-only; in remote/SSH mode the
  // provider IPC throws, so we self-hide that section rather than error the page.
  const loadProviders = useCallback(async () => {
    try {
      const [provs, active] = await Promise.all([
        discoverMemoryProviders(profile),
        window.hermesAPI.getConfig("memory.provider", profile),
      ]);
      setProviders(provs);
      setMemoryProvider(active);
      setProvidersAvailable(true);
    } catch {
      setProvidersAvailable(false);
    }
  }, [profile]);

  const load = useCallback(async () => {
    const [mem, foc, hk, proposals] = await Promise.all([
      readMemory(profile),
      readFocus(),
      window.hermesAPI.getDailyContextHookStatus(profile),
      listLearningProposals(profile).catch(() => []),
    ]);
    const m = mem;
    const parsed = parseUserMd(m.user.content);
    setProse(parsed.prose);
    setRules(parsed.rules);
    setUserCharLimit(m.user.charLimit ?? 2200);
    setMemory({
      content: m.memory.content,
      charLimit: m.memory.charLimit ?? 2200,
    });
    setFocus(foc);
    setHook(hk);
    setPendingMemoryCount(
      proposals.filter(
        (proposal) =>
          proposal.kind === "memory" && proposal.status === "pending",
      ).length,
    );
    setLoading(false);
    loadProviders().catch((error: unknown) => {
      console.error("[You] Failed to load memory providers:", error);
      setProvidersAvailable(false);
    });
  }, [profile, loadProviders]);

  useEffect(() => {
    setLoading(true);
    load().catch((error: unknown) => {
      console.error("[You] Failed to load personalization data:", error);
      setLoading(false);
    });
  }, [load]);

  // The one place USER.md is written. Refuses an over-budget save so the agent's
  // 2200-char USER.md window is never silently truncated.
  const persistUserMd = useCallback(
    async (nextProse: string, nextRules: Rule[]): Promise<SaveResult> => {
      const serialized = serializeUserMd(nextProse, nextRules);
      if (serialized.length > userCharLimit) {
        return {
          success: false,
          error: `Too long (${serialized.length}/${userCharLimit}). Shorten your note or a rule.`,
        };
      }
      const res = await writeUserProfile(serialized, profile);
      if (res.success) {
        setProse(nextProse);
        setRules(nextRules);
      }
      return res;
    },
    [profile, userCharLimit],
  );

  async function handleRulesChange(next: Rule[]): Promise<void> {
    setRulesError("");
    const res = await persistUserMd(prose, next);
    if (!res.success) setRulesError(res.error || "Couldn't save rules");
  }

  async function toggleHook(enabled: boolean): Promise<void> {
    setHookBusy(true);
    setHookError("");
    const res = await window.hermesAPI.setDailyContextHookEnabled(
      enabled,
      profile,
    );
    if (!res.success) setHookError(res.error || "Failed to update hook");
    const hk = await window.hermesAPI.getDailyContextHookStatus(profile);
    setHook(hk);
    setHookBusy(false);
  }

  function changeRules(next: Rule[]): void {
    handleRulesChange(next).catch((error: unknown) => {
      console.error("[You] Failed to save rules:", error);
      setRulesError(error instanceof Error ? error.message : String(error));
    });
  }

  function changeHook(enabled: boolean): void {
    toggleHook(enabled).catch((error: unknown) => {
      console.error("[You] Failed to update daily context hook:", error);
      setHookError(error instanceof Error ? error.message : String(error));
      setHookBusy(false);
    });
  }

  function runAudit(): void {
    handleRunAudit().catch((error: unknown) => {
      console.error("[You] Alignment audit failed:", error);
      setAuditError(error instanceof Error ? error.message : String(error));
      setAuditing(false);
    });
  }

  function refreshProviders(): void {
    loadProviders().catch((error: unknown) => {
      console.error("[You] Failed to refresh memory providers:", error);
      setProvidersAvailable(false);
    });
  }

  function selectView(next: YouView): void {
    setView(next);
    try {
      window.localStorage.setItem("hermes.personalization.view", next);
    } catch {
      /* localStorage is best-effort */
    }
  }

  function applyResponsePreset(ruleText: string): void {
    const next = rules.filter(
      (rule) =>
        !RESPONSE_STYLE_PRESETS.some((preset) => preset.rule === rule.text),
    );
    next.push({ text: ruleText, enabled: true });
    changeRules(next);
  }

  async function handleAddMemory(): Promise<void> {
    const content = memoryDraft.trim();
    if (!content) return;
    setMemoryBusy(true);
    setMemoryError("");
    try {
      const result = await addMemoryEntry(content, profile);
      if (!result.success) {
        setMemoryError(result.error || "Could not add this fact.");
        return;
      }
      setMemoryDraft("");
      await load();
    } catch (error) {
      setMemoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setMemoryBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="settings-container">
        <h1 className="settings-header">You</h1>
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="memory-header">
        <div>
          <h1 className="settings-header" style={{ marginBottom: 4 }}>
            You
          </h1>
          <p className="memory-subtitle">
            Teach My Assistant how you think — what it knows, how it responds,
            and the standing rules it follows. Everything here is yours to edit
            or turn off.
          </p>
        </div>
      </div>

      <div
        className="personalization-tabs"
        role="tablist"
        aria-label="Personalization"
      >
        {(
          [
            ["how", "How to work with me"],
            ["memory", "What you remember"],
            ["advanced", "Advanced"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            onClick={() => selectView(id)}
          >
            {label}
            {id === "memory" && pendingMemoryCount > 0 && (
              <span className="personalization-tab-badge">
                {pendingMemoryCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {view === "how" && (
        <>
          <div className="settings-section">
            <div className="settings-section-title">Response style</div>
            <p className="settings-field-hint">
              Pick a starting style. This creates one readable standing rule
              that you can edit or remove below.
            </p>
            <div className="response-style-grid">
              {RESPONSE_STYLE_PRESETS.map((preset) => {
                const active = rules.some(
                  (rule) => rule.enabled && rule.text === preset.rule,
                );
                return (
                  <button
                    key={preset.id}
                    className="response-style-card"
                    aria-pressed={active}
                    onClick={() => applyResponsePreset(preset.rule)}
                  >
                    <strong>{preset.label}</strong>
                    <span>{preset.rule}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <RulesManager rules={rules} onChange={changeRules} />
          {rulesError && <div className="memory-error">{rulesError}</div>}

          <EditorSection
            title="About you"
            hint="The useful context My Assistant should know about you. Shares the profile budget with your standing rules."
            value={prose}
            charLimit={userCharLimit}
            placeholder="e.g. Defensive equity investor. Flag tail risks and distinguish facts from assumptions."
            onSave={(content) => persistUserMd(content, rules)}
          />

          <EditorSection
            title="Today's focus"
            hint="A short-lived note for what matters right now. Keep it to 1–3 lines."
            value={focus}
            placeholder="e.g. India equities — defensive PSU basket; tracking macro and tail-risk signals."
            onSave={(content) => writeFocus(content)}
            headerAction={
              <label className="focus-context-toggle">
                <span>Use this focus in chats</span>
                <input
                  type="checkbox"
                  checked={!!hook?.enabled}
                  disabled={hookBusy}
                  onChange={(event) => changeHook(event.target.checked)}
                />
              </label>
            }
          />
          <p className="settings-field-hint personalization-context-status">
            {hookStatusText(hook)}
          </p>
          {hookError && <div className="memory-error">{hookError}</div>}
        </>
      )}

      {view === "memory" && (
        <>
          {pendingMemoryCount > 0 && (
            <div className="memory-review-callout">
              <div>
                <strong>
                  {pendingMemoryCount} suggested memor
                  {pendingMemoryCount === 1 ? "y" : "ies"}
                </strong>
                <span>
                  Review suggestions before they become durable facts.
                </span>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setSurface("learning")}
              >
                Review in Learning
              </button>
            </div>
          )}

          <div className="settings-section">
            <div className="settings-section-title">Add a fact</div>
            <div className="memory-add-fact">
              <textarea
                value={memoryDraft}
                onChange={(event) => setMemoryDraft(event.target.value)}
                placeholder="Something durable My Assistant should remember…"
                rows={3}
              />
              <button
                className="btn btn-primary btn-sm"
                disabled={memoryBusy || !memoryDraft.trim()}
                onClick={() => void handleAddMemory()}
              >
                {memoryBusy ? "Adding…" : "Add fact"}
              </button>
            </div>
            {memoryError && <div className="memory-error">{memoryError}</div>}
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Remembered facts</div>
            <p className="settings-field-hint">
              See where a memory came from, edit it, or remove it. Nothing is
              hidden behind a provider-specific format.
            </p>
            <MemoryTimeline profile={profile} onRefresh={() => void load()} />
          </div>

          <details className="personalization-source-editor">
            <summary>Edit MEMORY.md source</summary>
            <EditorSection
              title="Raw durable memory"
              hint="Advanced source view. Entries are separated by a line containing only §."
              value={memory.content}
              charLimit={memory.charLimit}
              placeholder="Durable facts, separated by § on their own line."
              onSave={(content) => writeMemory(content, profile)}
            />
          </details>
        </>
      )}

      {view === "advanced" && (
        <>
          <div className="settings-section">
            <SoulEditor profile={profile} />
          </div>

          <div className="settings-section">
            <div className="settings-section-title">Memory backend</div>
            <div className="memory-backend-summary">
              <div>
                <strong>
                  {memoryProvider
                    ? (providers.find(
                        (provider) => provider.name === memoryProvider,
                      )?.name ?? memoryProvider)
                    : "Built-in memory"}
                </strong>
                <span>
                  {memoryProvider
                    ? "External backend enabled for this profile"
                    : "On — recommended. Local, editable, and portable."}
                </span>
              </div>
              {providersAvailable && providers.length > 0 && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowMemoryProviders((shown) => !shown)}
                >
                  {showMemoryProviders
                    ? "Hide backends"
                    : "Change memory backend…"}
                </button>
              )}
            </div>
            {showMemoryProviders && providersAvailable && (
              <MemoryProviders
                providers={providers}
                activeProvider={memoryProvider}
                profile={profile}
                onRefresh={refreshProviders}
              />
            )}
          </div>

          <div className="settings-section">
            <div className="settings-section-title">
              Telos Alignment Auditor
            </div>
            <div className="settings-field">
              <p className="settings-field-hint">
                Compare recent vault changes against your objectives in TELOS.md
                and create an alignment roadmap.
              </p>
              <button
                className="btn btn-primary btn-sm"
                onClick={runAudit}
                disabled={auditing}
              >
                {auditing ? "Auditing…" : "Run Alignment Audit"}
              </button>
              {auditError && <div className="memory-error">{auditError}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
