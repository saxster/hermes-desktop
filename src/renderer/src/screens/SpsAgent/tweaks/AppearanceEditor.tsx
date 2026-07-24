import { useEffect, useMemo, useState } from "react";
import type { LoadedSkin } from "../../../../../shared/skins";
import { useTheme } from "../../../components/ThemeProvider";
import { getActiveSkinId, setActiveSkinId } from "../../../utils/skin";
import { useStore } from "../store";
import { SECTION_ORDER, type SectionId } from "../store/storeTypes";
import {
  ACCENTS,
  TWEAK_DEFAULTS,
  setSkinVars,
  type Tweaks,
} from "../lib/theme";
import { skinToSpsVars } from "../lib/skin";

type ThemePreset = "system" | "paper" | "midnight" | "warm" | "terminal";

const THEME_PRESETS: Array<{ id: ThemePreset; label: string; hint: string }> = [
  { id: "system", label: "System", hint: "Follow your Mac" },
  { id: "paper", label: "Paper", hint: "Bright and quiet" },
  { id: "midnight", label: "Midnight", hint: "Neutral near-black" },
  { id: "warm", label: "Warm Dark", hint: "Softer evening palette" },
  { id: "terminal", label: "Terminal", hint: "Green on black" },
];

const ACCENT_LABELS: Record<string, string> = {
  "#C79400": "Gold",
  "#1B4F8A": "Blue",
  "#A1202C": "Red",
  "#1F6B3A": "Green",
  "#5A3A8A": "Violet",
  "#0F6B78": "Teal",
  "#B45309": "Orange",
  "#9F3F77": "Rose",
};

const FONT_PROFILES: Array<{
  id: Tweaks["bodyfont"];
  label: string;
  sample: string;
}> = [
  { id: "sans", label: "System Sans", sample: "Clean and familiar" },
  { id: "humanist", label: "Humanist", sample: "Warm and readable" },
  { id: "serif", label: "Editorial Serif", sample: "Book-like reading" },
  { id: "mono", label: "Monospaced", sample: "Precise and technical" },
];

const SECTION_LABELS: Record<SectionId, string> = {
  meetings: "Meetings",
  recents: "Recents",
  agents: "Assistants",
  shared: "Shared",
  private: "Private",
  apps: "Notion apps",
  aiAssistant: "My Assistant",
  workspaceTools: "Workspace Tools",
};

function activePreset(theme: string, tweaks: Tweaks): ThemePreset {
  if (theme === "system") return "system";
  if (!tweaks.dark) return "paper";
  if (tweaks.darkSkin === "warm") return "warm";
  if (tweaks.darkSkin === "terminal") return "terminal";
  return "midnight";
}

export function AppearanceEditor({
  variant = "settings",
}: {
  variant?: "settings" | "panel";
}): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  const tweaks = useStore((state) => state.t);
  const setTweak = useStore((state) => state.setTweak);
  const sectionsEnabled = useStore((state) => state.sectionsEnabled);
  const setSectionEnabled = useStore((state) => state.setSectionEnabled);
  const [skins, setSkins] = useState<LoadedSkin[]>([]);
  const [activeSkin, setActiveSkin] = useState(() => getActiveSkinId() ?? "");

  useEffect(() => {
    let cancelled = false;
    if (!window.hermesAPI?.listSkins) return;
    void window.hermesAPI
      .listSkins()
      .then((loaded) => {
        if (!cancelled) setSkins(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = (): void => setTweak("dark", media.matches);
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, [setTweak, theme]);

  const preset = activePreset(theme, tweaks);
  const previewStyle = useMemo<React.CSSProperties>(() => {
    const fontFamily =
      tweaks.bodyfont === "serif"
        ? "Georgia, serif"
        : tweaks.bodyfont === "mono"
          ? "ui-monospace, monospace"
          : tweaks.bodyfont === "humanist"
            ? '"Avenir Next", Avenir, sans-serif'
            : "-apple-system, BlinkMacSystemFont, sans-serif";
    return {
      fontFamily,
      fontSize:
        tweaks.textScale === "small"
          ? 14
          : tweaks.textScale === "large"
            ? 18
            : 16,
      lineHeight:
        tweaks.lineSpacing === "compact"
          ? 1.4
          : tweaks.lineSpacing === "relaxed"
            ? 1.75
            : 1.55,
      color: tweaks.dark ? "#f1efe9" : "#29261b",
      background:
        tweaks.darkSkin === "terminal" && tweaks.dark
          ? "#07110b"
          : tweaks.dark
            ? tweaks.darkSkin === "warm"
              ? "#211f1a"
              : "#151515"
            : "#fbfaf7",
      borderColor: tweaks.accent,
    };
  }, [tweaks]);

  function changeSkin(id: string): void {
    setActiveSkin(id);
    setActiveSkinId(undefined, id || null);
    const skin = skins.find((candidate) => candidate.id === id);
    setSkinVars(id ? skinToSpsVars(skin?.skin ?? null) : {});
  }

  function applyPreset(id: ThemePreset): void {
    if (id === "system") {
      setTheme("system");
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      setTweak("dark", prefersDark);
      setTweak("darkSkin", "black");
      return;
    }
    if (id === "paper") {
      setTheme("light");
      setTweak("dark", false);
      return;
    }
    setTheme("dark");
    setTweak("dark", true);
    setTweak(
      "darkSkin",
      id === "warm" ? "warm" : id === "terminal" ? "terminal" : "black",
    );
  }

  function resetAppearance(): void {
    setTheme("system");
    changeSkin("");
    useStore.setState({ t: { ...TWEAK_DEFAULTS } });
  }

  return (
    <div className={`appearance-editor appearance-editor--${variant}`}>
      <div className="appearance-preview" style={previewStyle}>
        <span className="appearance-preview-kicker">LIVE PREVIEW</span>
        <strong>A calmer place to think</strong>
        <p>
          Your documents use this reading font, size, spacing, theme, and
          accent. The interface font stays familiar and stable.
        </p>
        <span
          className="appearance-preview-link"
          style={{ color: tweaks.accent }}
        >
          Linked thought →
        </span>
      </div>

      <fieldset className="appearance-fieldset">
        <legend>Theme</legend>
        <div className="appearance-preset-grid">
          {THEME_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="appearance-choice"
              aria-pressed={preset === option.id}
              onClick={() => applyPreset(option.id)}
            >
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="appearance-fieldset">
        <legend>Accent</legend>
        <div className="settings-accent-options" aria-label="Workspace accent">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              className="settings-accent-option"
              style={{ backgroundColor: accent }}
              aria-label={ACCENT_LABELS[accent] ?? accent}
              aria-pressed={
                tweaks.accent.toLowerCase() === accent.toLowerCase()
              }
              onClick={() => setTweak("accent", accent)}
            />
          ))}
          <label
            className="appearance-custom-color"
            title="Choose any accent color"
          >
            <span>+</span>
            <input
              type="color"
              aria-label="Custom accent color"
              value={
                /^#[0-9a-f]{6}$/i.test(tweaks.accent)
                  ? tweaks.accent
                  : "#C79400"
              }
              onChange={(event) => setTweak("accent", event.target.value)}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="appearance-fieldset">
        <legend>Reading font</legend>
        <div className="appearance-font-grid">
          {FONT_PROFILES.map((font) => (
            <button
              key={font.id}
              type="button"
              className={`appearance-font-choice appearance-font-choice--${font.id}`}
              aria-pressed={tweaks.bodyfont === font.id}
              onClick={() => setTweak("bodyfont", font.id)}
            >
              <strong>{font.label}</strong>
              <span>{font.sample}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="appearance-control-grid">
        <label>
          Text size
          <select
            aria-label="Text size"
            value={tweaks.textScale}
            onChange={(event) =>
              setTweak("textScale", event.target.value as Tweaks["textScale"])
            }
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>
        <label>
          Line spacing
          <select
            aria-label="Line spacing"
            value={tweaks.lineSpacing}
            onChange={(event) =>
              setTweak(
                "lineSpacing",
                event.target.value as Tweaks["lineSpacing"],
              )
            }
          >
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
            <option value="relaxed">Relaxed</option>
          </select>
        </label>
        <label>
          Interface density
          <select
            aria-label="Interface density"
            value={tweaks.density}
            onChange={(event) =>
              setTweak("density", event.target.value as Tweaks["density"])
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
        </label>
      </div>

      <fieldset className="appearance-fieldset">
        <legend>Layout</legend>
        <div className="appearance-control-grid">
          <label>
            Sidebar
            <select
              aria-label="Sidebar"
              value={tweaks.sidebar}
              onChange={(event) =>
                setTweak("sidebar", event.target.value as Tweaks["sidebar"])
              }
            >
              <option value="full">Full</option>
              <option value="icons">Icons only</option>
              <option value="hidden">Hidden</option>
            </select>
          </label>
          <label>
            Content width
            <select
              aria-label="Content width"
              value={tweaks.width}
              onChange={(event) =>
                setTweak("width", event.target.value as Tweaks["width"])
              }
            >
              <option value="narrow">Narrow</option>
              <option value="comfortable">Comfortable</option>
              <option value="wide">Wide</option>
              <option value="full">Full</option>
            </select>
          </label>
          <label>
            Home page
            <select
              aria-label="Home page"
              value={tweaks.homeSurface}
              onChange={(event) =>
                setTweak(
                  "homeSurface",
                  event.target.value as Tweaks["homeSurface"],
                )
              }
            >
              <option value="cockpit">Cockpit</option>
              <option value="doc">Document editor</option>
              <option value="chats">AI chats</option>
              <option value="inbox">Inbox review</option>
            </select>
          </label>
        </div>
      </fieldset>

      <details className="appearance-more">
        <summary>Customize sidebar sections</summary>
        <div className="appearance-toggle-list">
          {SECTION_ORDER.map((id) => (
            <label key={id}>
              <span>{SECTION_LABELS[id]}</span>
              <input
                type="checkbox"
                checked={sectionsEnabled[id]}
                onChange={(event) =>
                  setSectionEnabled(id, event.target.checked)
                }
              />
            </label>
          ))}
        </div>
      </details>

      {skins.length > 0 && (
        <details className="appearance-more">
          <summary>Custom skin</summary>
          <label>
            Installed skin
            <select
              value={activeSkin}
              onChange={(event) => changeSkin(event.target.value)}
            >
              <option value="">Default</option>
              {skins.map((skin) => (
                <option key={skin.id} value={skin.id}>
                  {skin.skin.name}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}

      <div className="appearance-footer">
        <span>Interface text always uses the macOS system font.</span>
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={resetAppearance}
        >
          Reset appearance
        </button>
      </div>
    </div>
  );
}
