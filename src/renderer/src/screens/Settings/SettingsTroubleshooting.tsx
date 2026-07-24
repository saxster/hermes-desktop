import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";
import { RefreshCw, FileText, Send } from "lucide-react";
import { ConfigHealth } from "./ConfigHealth";
import CapabilitySummary from "./CapabilitySummary";
import McpServersManager from "./McpServersManager";
import ResearchReachSummary from "./ResearchReachSummary";
import Diagnostics from "./Diagnostics";
import { PromptBudgetSection } from "./PromptBudgetSection";
import { HealthSurface } from "../SpsAgent/health/HealthSurface";

const TELEGRAM_COMMUNITY_URL = "https://t.me/hermes_agent_desktop";

type DesktopUpdateRoutineState = Awaited<
  ReturnType<Window["hermesAPI"]["getDesktopUpdateRoutine"]>
>;
type DesktopUpdateRoutineResult = NonNullable<
  DesktopUpdateRoutineState["lastResult"]
>;

// Read cached values from localStorage for instant display
function getCachedVersion(): string | null {
  try {
    return localStorage.getItem("hermes-version-cache");
  } catch {
    return null;
  }
}

function formatRoutineDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function SettingsTroubleshooting({
  profile,
  active,
}: {
  profile?: string;
  active: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const [hermesHome, setHermesHome] = useState("");

  // Hermes engine info — initialize from localStorage cache for instant display
  const [hermesVersion, setHermesVersion] = useState<string | null>(
    getCachedVersion,
  );
  const [appVersion, setAppVersion] = useState("");
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateResultType, setUpdateResultType] = useState<
    "success" | "error" | null
  >(null);
  const [desktopUpdateRoutine, setDesktopUpdateRoutineState] =
    useState<DesktopUpdateRoutineState | null>(null);
  const [desktopUpdateRunning, setDesktopUpdateRunning] = useState(false);
  const [desktopUpdateError, setDesktopUpdateError] = useState<string | null>(
    null,
  );

  // Log viewer state
  const [logContent, setLogContent] = useState("");
  const [logFile, setLogFile] = useState("gateway.log");
  const [logPath, setLogPath] = useState("");
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Debug dump
  const [dumpOutput, setDumpOutput] = useState<string | null>(null);
  const [dumpRunning, setDumpRunning] = useState(false);

  // Security states
  const [securityRunning, setSecurityRunning] = useState(false);
  const [securityOutput, setSecurityOutput] = useState<string | null>(null);

  const loadConfig = useCallback(async (): Promise<void> => {
    // Load fast config first (cached in main process)
    const [home, aVersion, desktopRoutine] = await Promise.all([
      window.hermesAPI.getHermesHome(profile),
      window.hermesAPI.getAppVersion(),
      window.hermesAPI.getDesktopUpdateRoutine(),
    ]);
    setHermesHome(home);
    setAppVersion(aVersion);
    setDesktopUpdateRoutineState(desktopRoutine);

    // Defer slow calls — background refresh, cached values show instantly
    window.hermesAPI.getHermesVersion().then((v) => {
      setHermesVersion(v);
      if (v) {
        try {
          localStorage.setItem("hermes-version-cache", v);
        } catch {
          /* ignore */
        }
      }
    });
  }, [profile]);

  useEffect(() => {
    Promise.resolve()
      .then(loadConfig)
      .catch((err: unknown) => {
        console.error("Failed to load settings:", err);
      });
  }, [loadConfig]);

  async function loadLogs(): Promise<void> {
    const result = await window.hermesAPI.readLogs(logFile, 300);
    setLogContent(result.content);
    setLogPath(result.path);
  }

  async function handleDoctor(): Promise<void> {
    setDoctorRunning(true);
    setDoctorOutput(null);
    const output = await window.hermesAPI.runHermesDoctor();
    setDoctorOutput(output);
    setDoctorRunning(false);
  }

  // Helper to fetch fresh version, clear backend cache, and update localStorage
  function refreshVersion(): void {
    window.hermesAPI.refreshHermesVersion().then((v) => {
      setHermesVersion(v);
      if (v) {
        try {
          localStorage.setItem("hermes-version-cache", v);
        } catch {
          /* ignore */
        }
      }
    });
  }

  async function handleUpdateHermes(): Promise<void> {
    setUpdating(true);
    setUpdateResult(null);
    const result = await window.hermesAPI.runHermesUpdate();
    setUpdating(false);
    if (result.success) {
      setUpdateResult(t("settings.updateSuccess"));
      setUpdateResultType("success");
      refreshVersion();
    } else {
      setUpdateResult(result.error || t("settings.updateFailed"));
      setUpdateResultType("error");
    }
  }

  async function handleDesktopUpdateSetting(
    settings: Partial<{ enabled: boolean; autoDownload: boolean }>,
  ): Promise<void> {
    setDesktopUpdateError(null);
    try {
      const updated = await window.hermesAPI.setDesktopUpdateRoutine(settings);
      setDesktopUpdateRoutineState(updated);
    } catch (err) {
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRunDesktopUpdateCheck(): Promise<void> {
    setDesktopUpdateRunning(true);
    setDesktopUpdateError(null);
    try {
      const result = await window.hermesAPI.runDesktopUpdateCheck();
      setDesktopUpdateRoutineState(
        await window.hermesAPI.getDesktopUpdateRoutine(),
      );
      if (result.status === "error") {
        setDesktopUpdateError(result.message);
      }
    } catch (err) {
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setDesktopUpdateRunning(false);
    }
  }

  // Parse "Hermes Agent v0.7.0 (2026.4.3) Project: ... Python: 3.11.15 OpenAI SDK: 2.30.0 Update available: ..."
  const parsedVersion = (() => {
    if (!hermesVersion) return null;
    const v = hermesVersion;
    const version = v.match(/v([\d.]+)/)?.[1] || "";
    const date = v.match(/\(([\d.]+)\)/)?.[1] || "";
    const python = v.match(/Python:\s*([\d.]+)/)?.[1] || "";
    const sdk = v.match(/OpenAI SDK:\s*([\d.]+)/)?.[1] || "";
    const updateMatch = v.match(/Update available:\s*(.+?)(?:\s*—|$)/);
    const updateInfo = updateMatch?.[1]?.trim() || null;
    return { version, date, python, sdk, updateInfo };
  })();
  const desktopLastResult: DesktopUpdateRoutineResult | null =
    desktopUpdateRoutine?.lastResult ?? null;

  return (
    <>
      <div className="settings-section" data-section-tab="troubleshooting">
        <div className="settings-section-title">Start here</div>
        <div className="settings-field">
          <p className="settings-field-hint">
            Run the health check below first. It identifies configuration issues
            and gives you the shortest available fix.
          </p>
          <details className="settings-technical-details">
            <summary>Check workspace files</summary>
            <HealthSurface profile={profile} embedded={true} />
          </details>
        </div>
      </div>

      <div data-section-tab="troubleshooting">
        <ConfigHealth />
      </div>

      <div className="settings-section" data-section-tab="troubleshooting">
        <div className="settings-section-title">
          {t("settings.sections.hermesAgent")}
        </div>
        <div className="settings-hermes-info">
          <div className="settings-hermes-row">
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">
                {t("common.engine")}
              </span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion
                    ? `v${parsedVersion.version}`
                    : t("settings.notDetected")}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">
                {t("common.released")}
              </span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion?.date || "—"}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">
                {t("common.desktop")}
              </span>
              {!appVersion ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {t("settings.version", { version: appVersion })}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">Python</span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion?.python || "—"}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">OpenAI SDK</span>
              {hermesVersion === null ? (
                <span className="skeleton skeleton-sm" />
              ) : (
                <span className="settings-hermes-value">
                  {parsedVersion?.sdk || "—"}
                </span>
              )}
            </div>
            <div className="settings-hermes-detail">
              <span className="settings-hermes-label">{t("common.home")}</span>
              {!hermesHome ? (
                <span className="skeleton skeleton-md" />
              ) : (
                <span className="settings-hermes-value settings-hermes-path">
                  {hermesHome}
                </span>
              )}
            </div>
          </div>
          {parsedVersion?.updateInfo && (
            <div className="settings-hermes-update-badge">
              {parsedVersion.updateInfo}
            </div>
          )}
          <div className="settings-hermes-actions">
            {parsedVersion?.updateInfo ? (
              <button
                className="btn btn-primary "
                onClick={() => {
                  handleUpdateHermes().catch((err: unknown) => {
                    setUpdating(false);
                    setUpdateResult(
                      err instanceof Error ? err.message : String(err),
                    );
                    setUpdateResultType("error");
                  });
                }}
                disabled={updating}
              >
                {updating ? t("settings.updating") : t("settings.updateEngine")}
              </button>
            ) : (
              <button className="btn btn-secondary" disabled>
                {t("settings.latestVersion")}
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={() => {
                handleDoctor().catch((err: unknown) => {
                  setDoctorRunning(false);
                  setDoctorOutput(
                    err instanceof Error ? err.message : String(err),
                  );
                });
              }}
              disabled={doctorRunning}
            >
              {doctorRunning
                ? t("settings.runningDiagnosis")
                : t("settings.runDiagnosis")}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setDumpRunning(true);
                setDumpOutput(null);
                window.hermesAPI
                  .runHermesDump()
                  .then(setDumpOutput)
                  .catch((err: unknown) => {
                    setDumpOutput(
                      err instanceof Error ? err.message : String(err),
                    );
                  })
                  .finally(() => setDumpRunning(false));
              }}
              disabled={dumpRunning}
            >
              {dumpRunning ? t("settings.running") : t("settings.debugDump")}
            </button>
          </div>
          {updateResult && (
            <div
              className={`settings-hermes-result ${updateResultType || "error"}`}
            >
              {updateResult}
            </div>
          )}
          {doctorOutput && (
            <pre className="settings-hermes-doctor">{doctorOutput}</pre>
          )}
          {dumpOutput && (
            <pre className="settings-hermes-doctor">{dumpOutput}</pre>
          )}
        </div>
      </div>

      <div className="settings-section" data-section-tab="troubleshooting">
        <div className="settings-section-title">
          {t("settings.desktopUpdates.title")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.desktopUpdates.nightlyCheck")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={desktopUpdateRoutine?.enabled ?? true}
                onChange={(e) =>
                  void handleDesktopUpdateSetting({
                    enabled: e.target.checked,
                  })
                }
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.desktopUpdates.nightlyCheckHint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.desktopUpdates.autoDownload")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={desktopUpdateRoutine?.autoDownload ?? false}
                onChange={(e) =>
                  void handleDesktopUpdateSetting({
                    autoDownload: e.target.checked,
                  })
                }
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.desktopUpdates.autoDownloadHint")}
          </div>
        </div>
        <div className="settings-hermes-row">
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.schedule")}
            </span>
            <span className="settings-hermes-value">
              {desktopUpdateRoutine?.schedule || "0 4 * * *"}
            </span>
          </div>
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.lastChecked")}
            </span>
            <span className="settings-hermes-value">
              {formatRoutineDate(desktopUpdateRoutine?.lastCheckedAt)}
            </span>
          </div>
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.nextCheck")}
            </span>
            <span className="settings-hermes-value">
              {formatRoutineDate(desktopUpdateRoutine?.nextCheckAt)}
            </span>
          </div>
          <div className="settings-hermes-detail">
            <span className="settings-hermes-label">
              {t("settings.desktopUpdates.lastStatus")}
            </span>
            <span className="settings-hermes-value">
              {desktopLastResult
                ? `${desktopLastResult.status}${
                    desktopLastResult.version
                      ? ` · v${desktopLastResult.version}`
                      : ""
                  }`
                : t("settings.desktopUpdates.unavailable")}
            </span>
          </div>
        </div>
        {desktopLastResult?.message && (
          <div className="settings-field-hint" style={{ marginTop: 10 }}>
            {desktopLastResult.message}
          </div>
        )}
        <div className="settings-hermes-actions" style={{ marginTop: 12 }}>
          <button
            className="btn btn-secondary"
            onClick={() => void handleRunDesktopUpdateCheck()}
            disabled={desktopUpdateRunning}
          >
            <RefreshCw size={14} style={{ marginRight: 6 }} />
            {desktopUpdateRunning
              ? t("settings.desktopUpdates.running")
              : t("settings.desktopUpdates.runNow")}
          </button>
        </div>
        {desktopUpdateError && (
          <div className="settings-hermes-result error">
            {desktopUpdateError}
          </div>
        )}
      </div>

      <div className="settings-section" data-section-tab="troubleshooting">
        <div className="settings-section-title">Community help</div>
        <div className="settings-field">
          <p className="settings-field-hint">
            Ask questions, report issues, and compare setups with other Hermes
            users.
          </p>
          <button
            className="btn btn-secondary"
            onClick={() =>
              window.hermesAPI.openExternal(TELEGRAM_COMMUNITY_URL)
            }
          >
            <Send size={14} aria-hidden="true" />
            Join Telegram Community
          </button>
        </div>
      </div>

      <PromptBudgetSection profile={profile} sectionTab="advanced" />

      {/* Diagnostics Section (MED-10) */}
      <Diagnostics sectionTab="advanced" />

      {/* Security Audit Section */}
      <div className="settings-section" data-section-tab="advanced">
        <div className="settings-section-title">Dependency Security Scan</div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 12 }}>
            Scan local package locks and skill dependencies against the OSV.dev
            database to identify known vulnerabilities.
          </div>
          <div
            className="settings-hermes-actions"
            style={{ marginBottom: securityOutput ? 12 : 0 }}
          >
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSecurityRunning(true);
                setSecurityOutput(null);
                window.hermesAPI
                  .runSecurityAudit(profile)
                  .then(setSecurityOutput)
                  .catch((err: unknown) => {
                    setSecurityOutput(
                      `Error running security audit: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  })
                  .finally(() => setSecurityRunning(false));
              }}
              disabled={securityRunning}
            >
              {securityRunning
                ? "Scanning Dependencies..."
                : "Run Security Scan"}
            </button>
          </div>
          {securityOutput && (
            <pre
              className="settings-hermes-doctor"
              style={{ maxHeight: 300, overflowY: "auto", fontSize: 12 }}
            >
              {securityOutput}
            </pre>
          )}
        </div>
      </div>

      <CapabilitySummary
        profile={profile}
        active={active}
        sectionTab="advanced"
      />
      <McpServersManager
        profile={profile}
        active={active}
        sectionTab="advanced"
      />
      <ResearchReachSummary
        profile={profile}
        active={active}
        sectionTab="advanced"
      />

      <div className="settings-section" data-section-tab="advanced">
        <div className="settings-section-title">
          <span
            style={{ cursor: "pointer" }}
            onClick={() => {
              const next = !logsExpanded;
              setLogsExpanded(next);
              if (next) {
                loadLogs().catch((err: unknown) => {
                  setLogContent(
                    `Failed to load logs: ${err instanceof Error ? err.message : String(err)}`,
                  );
                });
              }
            }}
          >
            <FileText
              size={14}
              style={{ marginRight: 6, verticalAlign: "middle" }}
            />
            {t("settings.logsSection")} {logsExpanded ? "▾" : "▸"}
          </span>
        </div>
        {logsExpanded && (
          <div className="settings-field">
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              {["gateway.log", "agent.log", "errors.log"].map((f) => (
                <button
                  key={f}
                  className={`btn btn-sm ${logFile === f ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => {
                    setLogFile(f);
                    window.hermesAPI
                      .readLogs(f, 300)
                      .then((r) => {
                        setLogContent(r.content);
                        setLogPath(r.path);
                      })
                      .catch((err: unknown) => {
                        setLogContent(
                          `Failed to load logs: ${err instanceof Error ? err.message : String(err)}`,
                        );
                      });
                  }}
                >
                  {f.replace(".log", "")}
                </button>
              ))}
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  loadLogs().catch((err: unknown) => {
                    setLogContent(
                      `Failed to load logs: ${err instanceof Error ? err.message : String(err)}`,
                    );
                  });
                }}
              >
                {t("settings.refresh")}
              </button>
            </div>
            {logPath && (
              <div className="settings-field-hint" style={{ marginBottom: 4 }}>
                {logPath}
              </div>
            )}
            <pre
              className="settings-hermes-doctor"
              style={{
                maxHeight: 300,
                overflow: "auto",
                fontSize: 11,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {logContent || t("settings.emptyLog")}
            </pre>
          </div>
        )}
      </div>
    </>
  );
}
