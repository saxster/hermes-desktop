import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../components/useI18n";
import {
  APP_ZOOM_DEFAULT,
  appZoomSettingsFor,
  type AppZoomSettings,
} from "../../../../shared/app-zoom";
import { WorkspaceAppearanceSettings } from "./WorkspaceAppearanceSettings";

export function SettingsPreferences(): React.JSX.Element {
  const { t } = useI18n();
  const [completionSound, setCompletionSoundState] = useState(false);
  const [appZoom, setAppZoom] = useState<AppZoomSettings>(() =>
    appZoomSettingsFor(APP_ZOOM_DEFAULT),
  );
  const [appZoomSaving, setAppZoomSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      window.hermesAPI.getAppZoomSettings(),
      window.hermesAPI.getCompletionSound(),
    ])
      .then(([zoom, sound]) => {
        setAppZoom(zoom);
        setCompletionSoundState(sound);
      })
      .catch((error: unknown) => {
        console.error("Failed to load general settings:", error);
      });
  }, []);

  useEffect(() => window.hermesAPI.onAppZoomSettingsChanged(setAppZoom), []);

  const updateAppZoom = useCallback(async (factor: number): Promise<void> => {
    const optimistic = appZoomSettingsFor(factor);
    setAppZoom(optimistic);
    setAppZoomSaving(true);
    try {
      setAppZoom(await window.hermesAPI.setAppZoomFactor(optimistic.factor));
    } catch (error) {
      console.error("Failed to update app zoom:", error);
      setAppZoom(await window.hermesAPI.getAppZoomSettings());
    } finally {
      setAppZoomSaving(false);
    }
  }, []);

  return (
    <>
      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">
          {t("settings.sections.appearance")}
        </div>
        <WorkspaceAppearanceSettings />
      </div>

      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">Display</div>
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
            Makes the entire app larger or smaller and persists after restart.
          </div>
        </div>
      </div>

      <div className="settings-section" data-section-tab="preferences">
        <div className="settings-section-title">Sounds</div>
        <div className="settings-field">
          <label className="settings-field-label">
            Play a sound when My Assistant finishes
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={completionSound}
                onChange={(event) => {
                  const next = event.target.checked;
                  setCompletionSoundState(next);
                  window.hermesAPI
                    .setCompletionSound(next)
                    .catch((error: unknown) => {
                      setCompletionSoundState(!next);
                      console.error("Failed to save completion sound:", error);
                    });
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
        </div>
      </div>
    </>
  );
}
