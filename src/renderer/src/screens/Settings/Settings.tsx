import { useEffect, useRef } from "react";
import type { SettingsSection } from "./settingsSections";
import { SETTINGS_SECTION_COPY } from "./settingsSections";
import { SettingsTroubleshooting } from "./SettingsTroubleshooting";
import { SettingsDataPrivacy } from "./SettingsDataPrivacy";
import { SettingsPreferences } from "./SettingsPreferences";
import { SettingsAdvanced } from "./SettingsAdvanced";

/**
 * Thin section router. All four section components stay mounted and own
 * their state and IPC loading; visibility is driven by the container's
 * `data-section` attribute and each child's `data-section-tab` (see
 * `.settings-container[data-section=…]` rules in main.css), so switching
 * sections never loses local UI state.
 */
function Settings({
  profile,
  section,
  onClose,
}: {
  profile?: string;
  section: SettingsSection;
  onClose?: () => void;
}): React.JSX.Element {
  const sectionCopy = SETTINGS_SECTION_COPY[section];
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.scrollTo({ top: 0 });
  }, [section]);

  return (
    <div
      className="settings-container"
      data-section={section}
      ref={containerRef}
    >
      <h1 className="settings-header">{sectionCopy.title}</h1>
      <p className="models-subtitle settings-section-subtitle">
        {sectionCopy.subtitle}
      </p>

      <SettingsTroubleshooting
        profile={profile}
        active={section === "troubleshooting" || section === "advanced"}
      />
      <SettingsDataPrivacy profile={profile} />
      <SettingsPreferences />
      <SettingsAdvanced profile={profile} onClose={onClose} />
    </div>
  );
}

export default Settings;
