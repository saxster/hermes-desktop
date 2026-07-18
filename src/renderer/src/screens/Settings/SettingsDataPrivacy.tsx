import { useState } from "react";
import { useI18n } from "../../components/useI18n";
import { Check, Download, Upload } from "lucide-react";
import {
  getAnalyticsConsent,
  setAnalyticsConsent,
} from "../../utils/analytics";
import WorkspaceBackups from "./WorkspaceBackups";
import { HealthSurface } from "../SpsAgent/health/HealthSurface";
import { StorageSettings } from "../SpsAgent/tweaks/TweaksPanel";

export function SettingsDataPrivacy({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [healthExpanded, setHealthExpanded] = useState(false);

  // Backup / Import state
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // Analytics consent
  const [analyticsEnabled, setAnalyticsEnabled] = useState(() =>
    getAnalyticsConsent(),
  );

  async function handleBackup(): Promise<void> {
    setBackingUp(true);
    setBackupResult(null);
    const result = await window.hermesAPI.runHermesBackup(profile);
    setBackingUp(false);
    if (result.success) {
      setBackupResult(`Backup created: ${result.path || "success"}`);
    } else {
      setBackupResult(result.error || "Backup failed.");
    }
  }

  async function handleImport(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tar.gz,.tgz,.zip";
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportResult(null);
      const filePath = (file as File & { path: string }).path;
      const result = await window.hermesAPI.runHermesImport(filePath, profile);
      setImporting(false);
      if (result.success) {
        setImportResult(t("settings.migrationComplete"));
      } else {
        setImportResult(result.error || t("settings.migrationFailed"));
      }
    };
    input.click();
  }

  return (
    <>
      {/* Vault Health Section */}
      <div className="settings-section" data-section-tab="dataPrivacy">
        <div className="settings-section-title">
          <span
            style={{
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
            }}
            onClick={() => setHealthExpanded(!healthExpanded)}
          >
            <Check size={14} style={{ marginRight: 6 }} />
            Vault Health {healthExpanded ? "▾" : "▸"}
          </span>
        </div>
        {healthExpanded && (
          <div
            className="settings-field"
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 16,
              marginTop: 12,
            }}
          >
            <HealthSurface profile={profile} embedded={true} />
          </div>
        )}
      </div>

      {/* Workspace Backups Section (MED-11) */}
      <WorkspaceBackups profile={profile} />

      <div className="settings-section" data-section-tab="dataPrivacy">
        <div className="settings-section-title">Workspace storage</div>
        <div className="settings-workspace-storage">
          <StorageSettings />
        </div>
      </div>

      <div className="settings-section" data-section-tab="dataPrivacy">
        <div className="settings-section-title">
          {t("settings.sections.privacy")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.analytics.label")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={analyticsEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setAnalyticsEnabled(enabled);
                  setAnalyticsConsent(enabled);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.analytics.hint")}
          </div>
          <ul
            className="settings-field-hint"
            style={{ paddingLeft: "1.25em", marginTop: 4 }}
          >
            <li>{t("settings.analytics.disclosure.uuid")}</li>
            <li>{t("settings.analytics.disclosure.platform")}</li>
            <li>{t("settings.analytics.disclosure.navigation")}</li>
            <li>{t("settings.analytics.disclosure.endpoint")}</li>
            <li>{t("settings.analytics.disclosure.notCollected")}</li>
          </ul>
        </div>
      </div>

      <div className="settings-section" data-section-tab="dataPrivacy">
        <div className="settings-section-title">
          {t("settings.dataSection")}
        </div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            {t("settings.dataHint")}
          </div>
          <div className="settings-hermes-actions">
            <button
              className="btn btn-secondary"
              onClick={() => {
                handleBackup().catch((err: unknown) => {
                  setBackingUp(false);
                  setBackupResult(
                    err instanceof Error ? err.message : String(err),
                  );
                });
              }}
              disabled={backingUp}
            >
              <Download size={14} style={{ marginRight: 6 }} />
              {backingUp ? t("settings.backingUp") : t("settings.exportBackup")}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                handleImport().catch((err: unknown) => {
                  setImporting(false);
                  setImportResult(
                    err instanceof Error ? err.message : String(err),
                  );
                });
              }}
              disabled={importing}
            >
              <Upload size={14} style={{ marginRight: 6 }} />
              {importing ? t("settings.importing") : t("settings.importBackup")}
            </button>
          </div>
          {backupResult && (
            <div
              className={`settings-hermes-result ${backupResult.includes("created") || backupResult.includes("success") ? "success" : "error"}`}
              style={{ marginTop: 8 }}
            >
              {backupResult}
            </div>
          )}
          {importResult && (
            <div
              className={`settings-hermes-result ${importResult.includes("complete") ? "success" : "error"}`}
              style={{ marginTop: 8 }}
            >
              {importResult}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
