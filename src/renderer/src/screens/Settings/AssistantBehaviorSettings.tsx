import { useCallback, useEffect, useState } from "react";
import { useStore as useSpsStore } from "../SpsAgent/store";
import type { AutonomyMode } from "../../../../shared/autonomy-policy";

export function AssistantBehaviorSettings({
  profile,
  onPersonalize,
}: {
  profile?: string;
  onPersonalize: () => void;
}): React.JSX.Element {
  const [autonomyMode, setAutonomyModeState] =
    useState<AutonomyMode>("INTERACTIVE");
  const [approvalTimeout, setApprovalTimeout] = useState("0");

  const load = useCallback(async (): Promise<void> => {
    const [mode, timeout] = await Promise.all([
      window.hermesAPI.getAutonomyMode(profile),
      window.hermesAPI.getConfig("approval.timeout_seconds", profile),
    ]);
    setAutonomyModeState(mode);
    setApprovalTimeout(String(parseInt(timeout || "0", 10) || 0));
  }, [profile]);

  useEffect(() => {
    void load().catch((error: unknown) => {
      console.error("Failed to load assistant behavior settings:", error);
    });
  }, [load]);

  return (
    <>
      <div className="settings-section assistant-personalization-callout">
        <div>
          <div className="settings-section-title">Personalization</div>
          <p className="settings-field-hint">
            Set your response style, standing rules, focus, and remembered facts
            in one uncluttered workspace.
          </p>
        </div>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            window.localStorage.setItem("hermes.personalization.view", "how");
            useSpsStore.getState().setSurface("you");
            onPersonalize();
          }}
        >
          Personalize My Assistant
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Action permissions</div>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="autonomy-mode">
            How much can My Assistant do without asking?
          </label>
          <select
            id="autonomy-mode"
            className="input settings-select"
            value={autonomyMode}
            onChange={(event) => {
              const previous = autonomyMode;
              const next = event.target.value as AutonomyMode;
              setAutonomyModeState(next);
              window.hermesAPI
                .setAutonomyMode(next, profile)
                .catch((error: unknown) => {
                  setAutonomyModeState(previous);
                  console.error("Failed to save autonomy mode:", error);
                });
            }}
          >
            <option value="READ_ONLY">Read only</option>
            <option value="INTERACTIVE">
              Ask before consequential actions
            </option>
            <option value="SCOPED_AUTOMATION">
              Use approved automation grants
            </option>
          </select>
          <div className="settings-field-hint">
            Commands, unknown tools, and unapproved external sends still require
            review. This setting applies to the current profile only.
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="approval-timeout">
            Auto-deny unanswered approvals after
          </label>
          <div className="settings-inline-control">
            <input
              id="approval-timeout"
              className="input"
              type="number"
              min={0}
              step={5}
              value={approvalTimeout}
              onChange={(event) => {
                const next = String(
                  Math.max(0, parseInt(event.target.value, 10) || 0),
                );
                setApprovalTimeout(next);
                void window.hermesAPI.setConfig(
                  "approval.timeout_seconds",
                  next,
                  profile,
                );
              }}
            />
            <span className="settings-field-hint">
              seconds (0 keeps waiting)
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
