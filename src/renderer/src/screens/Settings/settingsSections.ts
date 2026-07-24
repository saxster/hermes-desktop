import type { NormalizedAdminView } from "../../lib/openSettings";

export type SettingsSection = Extract<
  NormalizedAdminView,
  "preferences" | "dataPrivacy" | "troubleshooting" | "advanced"
>;

export const SETTINGS_SECTION_COPY: Record<
  SettingsSection,
  { title: string; subtitle: string }
> = {
  preferences: {
    title: "General",
    subtitle: "Appearance, display size, and everyday app behavior.",
  },
  dataPrivacy: {
    title: "Data & Privacy",
    subtitle: "Analytics, backups, exports, and local workspace data.",
  },
  troubleshooting: {
    title: "Help",
    subtitle: "Health checks, updates, community, and diagnostic reports.",
  },
  advanced: {
    title: "Developer settings",
    subtitle:
      "Remote access, storage internals, model routing, and diagnostics.",
  },
};
