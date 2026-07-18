import { useState, useEffect, useCallback } from "react";
import { useTheme } from "../../components/ThemeProvider";
import { THEME_OPTIONS } from "../../constants";
import { useStore as useSpsStore } from "../SpsAgent/store";
import { useI18n } from "../../components/useI18n";
import {
  APP_ZOOM_DEFAULT,
  appZoomSettingsFor,
  type AppZoomSettings,
} from "../../../../shared/app-zoom";
import { Send } from "lucide-react";
import { WorkspaceAppearanceSettings } from "./WorkspaceAppearanceSettings";
import { OwnerDeliverySettings } from "./OwnerDeliverySettings";

const TELEGRAM_COMMUNITY_URL = "https://t.me/hermes_agent_desktop";

export function SettingsPreferences({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();

  // Automation prefs (M2): scoped auto-approve + completion chime
  const [autoApprove, setAutoApproveState] = useState(false);
  const [completionSound, setCompletionSoundState] = useState(false);
  const [appZoom, setAppZoom] = useState<AppZoomSettings>(() =>
    appZoomSettingsFor(APP_ZOOM_DEFAULT),
  );
  const [appZoomSaving, setAppZoomSaving] = useState(false);
  // Approval auto-deny timeout (seconds; 0 = off). Opt-in operator safety.
  const [approvalTimeout, setApprovalTimeout] = useState("0");

  const loadConfig = useCallback(async (): Promise<void> => {
    const zoomSettings = await window.hermesAPI.getAppZoomSettings();
    setAppZoom(zoomSettings);

    // Automation prefs (auto-approve is per-profile; chime is app-level)
    window.hermesAPI.getAutoApprove(profile).then(setAutoApproveState);
    window.hermesAPI.getCompletionSound().then(setCompletionSoundState);
    window.hermesAPI
      .getConfig("approval.timeout_seconds", profile)
      .then((v) => setApprovalTimeout(String(parseInt(v || "0", 10) || 0)));
  }, [profile]);

  useEffect(() => {
    Promise.resolve()
      .then(loadConfig)
      .catch((err: unknown) => {
        console.error("Failed to load settings:", err);
      });
  }, [loadConfig]);

  useEffect(() => {
    return window.hermesAPI.onAppZoomSettingsChanged(setAppZoom);
  }, []);

  const updateAppZoom = useCallback(async (factor: number): Promise<void> => {
    const optimistic = appZoomSettingsFor(factor);
    setAppZoom(optimistic);
    setAppZoomSaving(true);
    try {
      const settings = await window.hermesAPI.setAppZoomFactor(
        optimistic.factor,
      );
      setAppZoom(settings);
    } catch (err) {
      console.error("Failed to update app zoom:", err);
      setAppZoom(await window.hermesAPI.getAppZoomSettings());
    } finally {
      setAppZoomSaving(false);
    }
  }, []);

  return (
    <>
      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">Community</div>
        <div className="settings-field">
          <div className="settings-field-hint" style={{ marginBottom: 10 }}>
            Join our Telegram group to ask questions, report issues, and chat
            with other Hermes users.
          </div>
          <div className="settings-hermes-actions">
            <button
              className="btn btn-secondary"
              onClick={() =>
                window.hermesAPI.openExternal(TELEGRAM_COMMUNITY_URL)
              }
              title={TELEGRAM_COMMUNITY_URL}
            >
              <Send size={14} style={{ marginRight: 6 }} />
              Join Telegram Community
            </button>
          </div>
        </div>
      </div>

      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">
          {t("settings.sections.appearance")}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.theme.label")}
          </label>
          <div className="settings-theme-options">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                className={`settings-theme-option ${theme === opt.value ? "active" : ""}`}
                onClick={() => {
                  setTheme(opt.value);
                  // Keep the SPS workspace (the source of truth) in lockstep:
                  // its Tweaks.dark drives both the workspace and, via
                  // applyTweaks → document root, this admin overlay.
                  const prefersDark = window.matchMedia(
                    "(prefers-color-scheme: dark)",
                  ).matches;
                  const dark =
                    opt.value === "dark" ||
                    (opt.value === "system" && prefersDark);
                  useSpsStore.getState().setTweak("dark", dark);
                }}
              >
                {opt.value === "system"
                  ? t("settings.theme.system")
                  : opt.value === "light"
                    ? t("settings.theme.light")
                    : t("settings.theme.dark")}
              </button>
            ))}
          </div>
          <div className="settings-field-hint">
            {t("settings.appearanceHint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="app-zoom-range">
            Display zoom
            <span className="settings-zoom-value">{appZoom.percent}%</span>
          </label>
          <div className="settings-zoom-control">
            <button
              className="btn btn-secondary settings-zoom-button"
              type="button"
              onClick={() => void updateAppZoom(appZoom.factor - appZoom.step)}
              disabled={appZoomSaving || appZoom.factor <= appZoom.min}
              aria-label="Decrease display zoom"
            >
              -
            </button>
            <input
              id="app-zoom-range"
              className="settings-zoom-range"
              type="range"
              min={appZoom.min}
              max={appZoom.max}
              step={appZoom.step}
              value={appZoom.factor}
              onChange={(event) =>
                void updateAppZoom(event.currentTarget.valueAsNumber)
              }
              aria-label="Display zoom"
              aria-valuetext={`${appZoom.percent}%`}
              disabled={appZoomSaving}
            />
            <button
              className="btn btn-secondary settings-zoom-button"
              type="button"
              onClick={() => void updateAppZoom(appZoom.factor + appZoom.step)}
              disabled={appZoomSaving || appZoom.factor >= appZoom.max}
              aria-label="Increase display zoom"
            >
              +
            </button>
            <button
              className="settings-zoom-reset"
              type="button"
              onClick={() => void updateAppZoom(APP_ZOOM_DEFAULT)}
              disabled={appZoomSaving || appZoom.factor === APP_ZOOM_DEFAULT}
            >
              Reset
            </button>
          </div>
          <div className="settings-field-hint">
            Make text and interface controls larger or smaller. Applies after
            restart too.
          </div>
        </div>
        <WorkspaceAppearanceSettings />
      </div>

      <OwnerDeliverySettings profile={profile} />

      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">Automation</div>
        <div className="settings-field">
          <label className="settings-field-label">
            Scoped auto-approve
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => {
                  const val = e.target.checked;
                  setAutoApproveState(val);
                  window.hermesAPI
                    .setAutoApprove(val, profile)
                    .catch((err: unknown) => {
                      setAutoApproveState(!val);
                      console.error(
                        "Failed to save auto-approve setting:",
                        err,
                      );
                    });
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            Applies to this profile only. Auto-approves just provably-safe,
            read-only commands (ls, cat, git status, grep…). Writes, deletes,
            installs, network sends, and anything chained or redirected always
            ask for your approval. Off by default; turn it off any time to
            require manual approval again.
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            Completion sound
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={completionSound}
                onChange={(e) => {
                  const val = e.target.checked;
                  setCompletionSoundState(val);
                  window.hermesAPI
                    .setCompletionSound(val)
                    .catch((err: unknown) => {
                      setCompletionSoundState(!val);
                      console.error("Failed to save completion sound:", err);
                    });
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            Play a system chime when My Assistant finishes — the cue for which
            of several parallel runs just landed.
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="approval-timeout">
            Approval auto-deny timeout
          </label>
          <input
            id="approval-timeout"
            className="input"
            type="number"
            min={0}
            step={5}
            style={{ maxWidth: 140 }}
            value={approvalTimeout}
            onChange={(e) => {
              const next = String(
                Math.max(0, parseInt(e.target.value, 10) || 0),
              );
              setApprovalTimeout(next);
              void window.hermesAPI.setConfig(
                "approval.timeout_seconds",
                next,
                profile,
              );
            }}
          />
          <div className="settings-field-hint">
            Seconds before an unanswered command-approval auto-denies (a safety
            default for when you operate from mobile). <strong>0 = off</strong>;
            approvals then wait indefinitely for your decision.
          </div>
        </div>
      </div>
    </>
  );
}
