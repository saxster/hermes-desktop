import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";
import { useEngineCapabilities } from "../../hooks/useEngineCapabilities";
import { Check, Refresh, RotateCcw } from "../../assets/icons";
import type {
  EngineContractVerificationResult,
  EngineContractVerificationStatus,
} from "../../../../shared/engine-contract";

type AgentUpdateRoutineResult = {
  checkedAt: string;
  status:
    | "current"
    | "available"
    | "updated"
    | "skipped"
    | "contract-broken"
    | "error";
  message: string;
  phase?: "check" | "update" | "restart" | "verify";
  reason?: string;
  restartStatus?: "not-needed" | "restarted" | "failed";
  restartMessage?: string;
  localHead?: string;
  upstreamHead?: string;
  behindBy?: number;
  changelog?: string;
  releaseTag?: string;
  contract?: EngineContractVerificationResult;
};

type AgentUpdateRoutineState = {
  enabled: boolean;
  autoApply: boolean;
  channel: "release" | "main";
  schedule: string;
  timezone: string;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastResult: AgentUpdateRoutineResult | null;
  autoApplySuppressed: boolean;
  autoApplySuppressionReason: "contract-broken" | null;
  autoApplySuppressedAt: string | null;
  autoApplySuppressedSha: string | null;
};

type UpstreamWatchCategory =
  | "contract-risk"
  | "runtime-required"
  | "api-contract"
  | "desktop-parity"
  | "security"
  | "cron-automation"
  | "provider-model"
  | "docs-only"
  | "ignore";

type UpstreamWatchState = {
  lastRunAt: string | null;
  lastSeenCommit: string | null;
  lastSeenRelease: string | null;
  latestReportPath: string | null;
  anchorSha?: string | null;
  pendingCommitCount?: number;
  contractRiskCount?: number;
  classifiedCounts: Partial<Record<UpstreamWatchCategory, number>>;
  lastError?: string;
};

/**
 * The engine-maintenance cluster: agent update routine, engine
 * capabilities/contract/rollback, and upstream watch. These three share
 * state both ways (an update check can set the contract result; a
 * rollback refreshes the update routine), so they stay in one component.
 */
export function ProviderEngineOps({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  const [agentUpdateRoutine, setAgentUpdateRoutine] =
    useState<AgentUpdateRoutineState | null>(null);
  const [agentUpdateBusy, setAgentUpdateBusy] = useState(false);
  const [agentUpdateMessage, setAgentUpdateMessage] = useState<string | null>(
    null,
  );
  const [agentUpdateAcknowledgeBusy, setAgentUpdateAcknowledgeBusy] =
    useState(false);
  const [upstreamWatch, setUpstreamWatch] = useState<UpstreamWatchState | null>(
    null,
  );
  const [upstreamWatchBusy, setUpstreamWatchBusy] = useState(false);
  const [upstreamWatchMessage, setUpstreamWatchMessage] = useState<
    string | null
  >(null);
  const [engineContractBusy, setEngineContractBusy] = useState(false);
  const [engineContractMessage, setEngineContractMessage] = useState<
    string | null
  >(null);
  const [engineContractResult, setEngineContractResult] =
    useState<EngineContractVerificationResult | null>(null);
  const [engineRollbackBusy, setEngineRollbackBusy] = useState(false);
  const [engineRollbackMessage, setEngineRollbackMessage] = useState<
    string | null
  >(null);

  const loadEngineOps = useCallback(async (): Promise<void> => {
    const [routine, watch] = await Promise.all([
      window.hermesAPI.getHermesAgentUpdateRoutine(profile),
      window.hermesAPI.getHermesUpstreamWatchState(profile),
    ]);
    setAgentUpdateRoutine(routine);
    setUpstreamWatch(watch);
  }, [profile]);

  useEffect(() => {
    loadEngineOps().catch((err: unknown) => {
      console.error("Failed to load engine maintenance state:", err);
    });
  }, [loadEngineOps]);

  // Refresh when the screen becomes visible
  useEffect(() => {
    if (!visible) return;
    loadEngineOps().catch((err: unknown) => {
      console.error("Failed to refresh engine maintenance state:", err);
    });
  }, [visible, loadEngineOps]);

  async function handleAgentUpdateSetting(
    settings: Partial<{
      enabled: boolean;
      autoApply: boolean;
      channel: "release" | "main";
    }>,
  ): Promise<void> {
    const updated = await window.hermesAPI.setHermesAgentUpdateRoutine(
      settings,
      profile,
    );
    setAgentUpdateRoutine(updated);
  }

  async function handleRunAgentUpdateCheck(): Promise<void> {
    setAgentUpdateBusy(true);
    setAgentUpdateMessage(null);
    try {
      const result = await window.hermesAPI.runHermesAgentUpdateCheck(profile);
      if (result.contract) setEngineContractResult(result.contract);
      setAgentUpdateMessage(result.message);
      setAgentUpdateRoutine(
        await window.hermesAPI.getHermesAgentUpdateRoutine(profile),
      );
    } catch (err) {
      setAgentUpdateMessage(
        err instanceof Error ? err.message : t("providers.agentUpdates.failed"),
      );
    } finally {
      setAgentUpdateBusy(false);
    }
  }

  async function handleAcknowledgeAgentUpdateBreak(): Promise<void> {
    setAgentUpdateAcknowledgeBusy(true);
    setAgentUpdateMessage(null);
    try {
      const updated =
        await window.hermesAPI.acknowledgeHermesAgentUpdateContractBreak(
          profile,
        );
      setAgentUpdateRoutine(updated);
      setAgentUpdateMessage(t("providers.agentUpdates.acknowledged"));
    } catch (err) {
      setAgentUpdateMessage(
        err instanceof Error ? err.message : t("providers.agentUpdates.failed"),
      );
    } finally {
      setAgentUpdateAcknowledgeBusy(false);
    }
  }

  async function handleRunUpstreamWatch(): Promise<void> {
    setUpstreamWatchBusy(true);
    setUpstreamWatchMessage(null);
    try {
      const state = await window.hermesAPI.runHermesUpstreamWatch(profile);
      setUpstreamWatch(state);
      setUpstreamWatchMessage(
        state.latestReportPath
          ? t("providers.upstreamWatch.reportReady")
          : state.lastError || t("providers.upstreamWatch.failed"),
      );
    } catch (err) {
      setUpstreamWatchMessage(
        err instanceof Error
          ? err.message
          : t("providers.upstreamWatch.failed"),
      );
    } finally {
      setUpstreamWatchBusy(false);
    }
  }

  async function handleVerifyEngineContract(): Promise<void> {
    setEngineContractBusy(true);
    setEngineContractMessage(null);
    try {
      const result = await window.hermesAPI.verifyEngineContract(profile);
      setEngineContractResult(result);
      setEngineContractMessage(
        t(`providers.engineCapabilities.verifyResult.${result.status}`),
      );
    } catch (err) {
      setEngineContractMessage(
        err instanceof Error
          ? err.message
          : t("providers.engineCapabilities.verifyFailed"),
      );
    } finally {
      setEngineContractBusy(false);
    }
  }

  async function handleRollbackEngine(): Promise<void> {
    const sha = engineCapabilities.state?.lastVerifiedSha;
    if (!sha) return;
    if (
      !window.confirm(
        t("providers.engineCapabilities.rollbackConfirm", {
          sha: shortCommit(sha),
        }),
      )
    ) {
      return;
    }

    setEngineRollbackBusy(true);
    setEngineRollbackMessage(null);
    try {
      const result = await window.hermesAPI.rollbackEngine(profile);
      if (!result.success) {
        setEngineRollbackMessage(
          result.error || t("providers.engineCapabilities.rollbackFailed"),
        );
        return;
      }
      setEngineRollbackMessage(
        t("providers.engineCapabilities.rollbackSucceeded", {
          sha: shortCommit(result.sha || sha),
        }),
      );
      await engineCapabilities.refresh();
      setAgentUpdateRoutine(
        await window.hermesAPI.getHermesAgentUpdateRoutine(profile),
      );
    } catch (err) {
      setEngineRollbackMessage(
        err instanceof Error
          ? err.message
          : t("providers.engineCapabilities.rollbackFailed"),
      );
    } finally {
      setEngineRollbackBusy(false);
    }
  }

  function formatWatchCounts(
    counts: UpstreamWatchState["classifiedCounts"] | undefined,
  ): string {
    if (!counts) return t("providers.upstreamWatch.noCounts");
    const entries = Object.entries(counts)
      .filter(([, count]) => Boolean(count))
      .map(([key, count]) => `${key}: ${count}`);
    return entries.length
      ? entries.join(", ")
      : t("providers.upstreamWatch.noCounts");
  }

  function shortCommit(value: string | null | undefined): string {
    return value ? value.slice(0, 7) : t("providers.agentUpdates.never");
  }

  function formatUpdateTime(value: string | null | undefined): string {
    if (!value) return t("providers.agentUpdates.never");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  function formatUpdateSchedule(
    nextCheckAt: string | null | undefined,
  ): string {
    const parsed = nextCheckAt ? new Date(nextCheckAt) : new Date();
    const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
    if (!nextCheckAt || Number.isNaN(parsed.getTime())) {
      date.setHours(4, 0, 0, 0);
    }
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  }

  function updateStatusClass(
    status: AgentUpdateRoutineResult["status"],
  ): string {
    if (status === "available" || status === "skipped") {
      return "provider-status-warning";
    }
    if (status === "error" || status === "contract-broken") {
      return "provider-status-error";
    }
    return "provider-status-success";
  }

  function engineContractStatusClass(
    status: EngineContractVerificationStatus | undefined,
  ): string {
    if (status === "broken") return "provider-status-error";
    if (status === "unknown") return "provider-status-warning";
    return "provider-status-success";
  }

  function formatEngineContractFindings(
    result: EngineContractVerificationResult | null,
  ): string {
    const count = result?.findings.length ?? 0;
    if (count === 0) return t("providers.engineCapabilities.noFindings");
    return count === 1
      ? t("providers.engineCapabilities.findingCountOne", { count })
      : t("providers.engineCapabilities.findingCountOther", { count });
  }

  const engineCapabilities = useEngineCapabilities(profile, !!visible);
  const engineSnapshot = engineCapabilities.state?.snapshot ?? null;
  const engineVerification =
    engineContractResult ?? engineCapabilities.state?.lastVerification ?? null;
  const enabledEngineFeatureCount = engineSnapshot
    ? Object.values(engineSnapshot.features).filter((value) => value === true)
        .length
    : 0;
  const engineEndpointCount = engineSnapshot
    ? Object.keys(engineSnapshot.endpoints).length
    : 0;
  const engineCapabilityError =
    engineCapabilities.error || engineSnapshot?.error || null;
  const engineCapabilityStatus = engineCapabilities.loading
    ? t("providers.engineCapabilities.loading")
    : engineSnapshot?.status === "ready"
      ? t("providers.engineCapabilities.status.ready")
      : t("providers.engineCapabilities.status.unknown");

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.agentUpdates.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.agentUpdates.sectionHint")}
        </div>
        <div className="provider-update-panel">
          <div className="provider-update-controls">
            <label className="provider-update-toggle">
              <input
                type="checkbox"
                checked={agentUpdateRoutine?.enabled ?? true}
                onChange={(event) =>
                  void handleAgentUpdateSetting({
                    enabled: event.currentTarget.checked,
                  })
                }
              />
              <span>{t("providers.agentUpdates.enabled")}</span>
            </label>
            <label className="provider-update-toggle">
              <input
                type="checkbox"
                checked={agentUpdateRoutine?.autoApply ?? false}
                onChange={(event) =>
                  void handleAgentUpdateSetting({
                    autoApply: event.currentTarget.checked,
                  })
                }
              />
              <span>{t("providers.agentUpdates.autoApply")}</span>
            </label>
            <label className="provider-update-toggle">
              <span>{t("providers.agentUpdates.channel")}</span>
              <select
                aria-label={t("providers.agentUpdates.channel")}
                value={agentUpdateRoutine?.channel ?? "release"}
                onChange={(event) =>
                  void handleAgentUpdateSetting({
                    channel: event.currentTarget.value as "release" | "main",
                  })
                }
              >
                <option value="release">
                  {t("providers.agentUpdates.releaseChannel")}
                </option>
                <option value="main">
                  {t("providers.agentUpdates.mainChannel")}
                </option>
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void handleRunAgentUpdateCheck()}
              disabled={agentUpdateBusy}
            >
              <Refresh size={14} />
              {agentUpdateBusy
                ? t("providers.agentUpdates.running")
                : t("providers.agentUpdates.runNow")}
            </button>
            {agentUpdateRoutine?.autoApplySuppressed && (
              <button
                type="button"
                className="btn btn-secondary btn-sm provider-update-run"
                onClick={() => void handleAcknowledgeAgentUpdateBreak()}
                disabled={agentUpdateAcknowledgeBusy}
              >
                <Check size={14} />
                {agentUpdateAcknowledgeBusy
                  ? t("providers.agentUpdates.acknowledging")
                  : t("providers.agentUpdates.acknowledge")}
              </button>
            )}
          </div>
          <div className="provider-update-grid">
            <div>
              <span>{t("providers.agentUpdates.schedule")}</span>
              <strong>
                {formatUpdateSchedule(agentUpdateRoutine?.nextCheckAt)}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.lastChecked")}</span>
              <strong>
                {formatUpdateTime(agentUpdateRoutine?.lastCheckedAt)}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.nextCheck")}</span>
              <strong>
                {formatUpdateTime(agentUpdateRoutine?.nextCheckAt)}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.mode")}</span>
              <strong>
                {agentUpdateRoutine?.autoApplySuppressed
                  ? t("providers.agentUpdates.autoApplyPausedMode")
                  : agentUpdateRoutine?.autoApply
                    ? t("providers.agentUpdates.autoApplyMode")
                    : t("providers.agentUpdates.notifyOnly")}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.channel")}</span>
              <strong>
                {agentUpdateRoutine?.channel === "main"
                  ? t("providers.agentUpdates.mainChannel")
                  : t("providers.agentUpdates.releaseChannel")}
              </strong>
            </div>
            <div>
              <span>{t("providers.agentUpdates.lastResult")}</span>
              {agentUpdateRoutine?.lastResult ? (
                <strong
                  className={`provider-update-status ${updateStatusClass(
                    agentUpdateRoutine.lastResult.status,
                  )}`}
                >
                  {t(
                    `providers.agentUpdates.status.${agentUpdateRoutine.lastResult.status}`,
                  )}
                </strong>
              ) : (
                <strong>{t("providers.agentUpdates.noResult")}</strong>
              )}
            </div>
          </div>
          {agentUpdateRoutine?.autoApplySuppressed && (
            <div className="provider-update-message">
              {t("providers.agentUpdates.autoApplyPaused", {
                sha: shortCommit(agentUpdateRoutine.autoApplySuppressedSha),
              })}
            </div>
          )}
          {(agentUpdateMessage || agentUpdateRoutine?.lastResult?.message) && (
            <div className="provider-update-message">
              {agentUpdateMessage || agentUpdateRoutine?.lastResult?.message}
            </div>
          )}
          {agentUpdateRoutine?.lastResult?.changelog && (
            <pre className="provider-update-changelog">
              {agentUpdateRoutine.lastResult.changelog
                .split("\n")
                .slice(0, 8)
                .join("\n")}
            </pre>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.engineCapabilities.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.engineCapabilities.sectionHint")}
        </div>
        <div className="provider-update-panel">
          <div className="provider-update-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void engineCapabilities.refresh()}
              disabled={
                engineCapabilities.loading || engineCapabilities.refreshing
              }
            >
              <Refresh size={14} />
              {engineCapabilities.refreshing
                ? t("providers.engineCapabilities.refreshing")
                : t("providers.engineCapabilities.refresh")}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void handleVerifyEngineContract()}
              disabled={engineContractBusy}
            >
              <Refresh size={14} />
              {engineContractBusy
                ? t("providers.engineCapabilities.verifyingContract")
                : t("providers.engineCapabilities.verifyContract")}
            </button>
            {engineCapabilities.state?.lastVerifiedSha && (
              <button
                type="button"
                className="btn btn-secondary btn-sm provider-update-run"
                onClick={() => void handleRollbackEngine()}
                disabled={engineRollbackBusy}
              >
                <RotateCcw size={14} />
                {engineRollbackBusy
                  ? t("providers.engineCapabilities.rollingBack")
                  : t("providers.engineCapabilities.rollback")}
              </button>
            )}
          </div>
          <div className="provider-update-grid">
            <div>
              <span>{t("providers.engineCapabilities.statusLabel")}</span>
              <strong>{engineCapabilityStatus}</strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.installedSha")}</span>
              <strong>
                {shortCommit(engineCapabilities.state?.installedSha)}
              </strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.features")}</span>
              <strong>
                {t("providers.engineCapabilities.enabledFeatures", {
                  count: enabledEngineFeatureCount,
                })}
              </strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.endpoints")}</span>
              <strong>
                {engineEndpointCount === 1
                  ? t("providers.engineCapabilities.endpointCountOne", {
                      count: engineEndpointCount,
                    })
                  : t("providers.engineCapabilities.endpointCountOther", {
                      count: engineEndpointCount,
                    })}
              </strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.fetchedAt")}</span>
              <strong>{formatUpdateTime(engineSnapshot?.fetchedAt)}</strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.contractStatus")}</span>
              {engineVerification ? (
                <strong
                  className={`provider-update-status ${engineContractStatusClass(
                    engineVerification.status,
                  )}`}
                >
                  {t(
                    `providers.engineCapabilities.contractStatusValue.${engineVerification.status}`,
                  )}
                </strong>
              ) : (
                <strong>
                  {t("providers.engineCapabilities.noVerification")}
                </strong>
              )}
            </div>
            <div>
              <span>{t("providers.engineCapabilities.contractCheckedAt")}</span>
              <strong>{formatUpdateTime(engineVerification?.checkedAt)}</strong>
            </div>
            <div>
              <span>{t("providers.engineCapabilities.contractFindings")}</span>
              <strong>
                {formatEngineContractFindings(engineVerification)}
              </strong>
            </div>
          </div>
          {engineContractMessage && (
            <div className="provider-update-message">
              {engineContractMessage}
            </div>
          )}
          {engineCapabilityError && (
            <div className="provider-update-message">
              {engineCapabilityError}
            </div>
          )}
          {engineRollbackMessage && (
            <div className="provider-update-message">
              {engineRollbackMessage}
            </div>
          )}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.upstreamWatch.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.upstreamWatch.sectionHint")}
        </div>
        <div className="provider-update-panel">
          <div className="provider-update-controls">
            <button
              type="button"
              className="btn btn-secondary btn-sm provider-update-run"
              onClick={() => void handleRunUpstreamWatch()}
              disabled={upstreamWatchBusy}
            >
              <Refresh size={14} />
              {upstreamWatchBusy
                ? t("providers.upstreamWatch.running")
                : t("providers.upstreamWatch.runNow")}
            </button>
            {upstreamWatch?.latestReportPath && (
              <button
                type="button"
                className="btn btn-secondary btn-sm provider-update-run"
                onClick={() =>
                  void window.hermesAPI.openFileInEditor(
                    upstreamWatch.latestReportPath as string,
                  )
                }
              >
                {t("providers.upstreamWatch.openReport")}
              </button>
            )}
          </div>
          <div className="provider-update-grid">
            <div>
              <span>{t("providers.upstreamWatch.lastRun")}</span>
              <strong>{formatUpdateTime(upstreamWatch?.lastRunAt)}</strong>
            </div>
            <div>
              <span>{t("providers.upstreamWatch.latestCommit")}</span>
              <strong>{shortCommit(upstreamWatch?.lastSeenCommit)}</strong>
            </div>
            <div>
              <span>{t("providers.upstreamWatch.latestRelease")}</span>
              <strong>
                {upstreamWatch?.lastSeenRelease ||
                  t("providers.agentUpdates.never")}
              </strong>
            </div>
            {upstreamWatch?.anchorSha && (
              <div>
                <span>{t("providers.upstreamWatch.anchor")}</span>
                <strong>{shortCommit(upstreamWatch.anchorSha)}</strong>
              </div>
            )}
            {typeof upstreamWatch?.pendingCommitCount === "number" && (
              <div>
                <span>{t("providers.upstreamWatch.pendingCommits")}</span>
                <strong>{upstreamWatch.pendingCommitCount}</strong>
              </div>
            )}
            {typeof upstreamWatch?.contractRiskCount === "number" && (
              <div>
                <span>{t("providers.upstreamWatch.contractRiskFiles")}</span>
                <strong>{upstreamWatch.contractRiskCount}</strong>
              </div>
            )}
            <div>
              <span>{t("providers.upstreamWatch.classifiedCounts")}</span>
              <strong>
                {formatWatchCounts(upstreamWatch?.classifiedCounts)}
              </strong>
            </div>
            {upstreamWatch?.latestReportPath && (
              <div className="provider-update-path-row">
                <span>{t("providers.upstreamWatch.reportPath")}</span>
                <strong>{upstreamWatch.latestReportPath}</strong>
              </div>
            )}
          </div>
          {(upstreamWatchMessage || upstreamWatch?.lastError) && (
            <div className="provider-update-message">
              {upstreamWatchMessage || upstreamWatch?.lastError}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
