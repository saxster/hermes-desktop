import { useEffect, useState } from "react";
import type { LoadedSkin } from "../../../../shared/skins";
import { useStore as useSpsStore } from "../SpsAgent/store";
import { ACCENTS, setSkinVars, type Tweaks } from "../SpsAgent/lib/theme";
import { skinToSpsVars } from "../SpsAgent/lib/skin";
import { getActiveSkinId, setActiveSkinId } from "../../utils/skin";

const ACCENT_LABELS: Record<string, string> = {
  "#C79400": "Gold",
  "#1B4F8A": "Blue",
  "#A1202C": "Red",
  "#1F6B3A": "Green",
  "#5A3A8A": "Violet",
};

export function WorkspaceAppearanceSettings(): React.JSX.Element {
  const tweaks = useSpsStore((state) => state.t);
  const setTweak = useSpsStore((state) => state.setTweak);
  const [skins, setSkins] = useState<LoadedSkin[]>([]);
  const [activeSkin, setActiveSkin] = useState(() => getActiveSkinId() ?? "");

  useEffect(() => {
    let cancelled = false;
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

  const changeSkin = (id: string): void => {
    setActiveSkin(id);
    setActiveSkinId(undefined, id || null);
    const skin = skins.find((candidate) => candidate.id === id);
    setSkinVars(id ? skinToSpsVars(skin?.skin ?? null) : {});
  };

  return (
    <>
      {tweaks.dark && (
        <div className="settings-field">
          <label
            className="settings-field-label"
            htmlFor="workspace-dark-palette"
          >
            Dark palette
          </label>
          <select
            id="workspace-dark-palette"
            className="input settings-compact-select"
            value={tweaks.darkSkin}
            onChange={(event) =>
              setTweak("darkSkin", event.target.value as Tweaks["darkSkin"])
            }
          >
            <option value="black">Black</option>
            <option value="warm">Warm</option>
            <option value="terminal">Terminal</option>
          </select>
        </div>
      )}

      <div className="settings-field">
        <span className="settings-field-label">Accent</span>
        <div className="settings-accent-options" aria-label="Workspace accent">
          {ACCENTS.map((accent) => (
            <button
              key={accent}
              type="button"
              className="settings-accent-option"
              style={{ backgroundColor: accent }}
              aria-label={ACCENT_LABELS[accent] ?? accent}
              aria-pressed={tweaks.accent === accent}
              onClick={() => setTweak("accent", accent)}
            />
          ))}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="workspace-density">
          Interface density
        </label>
        <select
          id="workspace-density"
          className="input settings-compact-select"
          value={tweaks.density}
          onChange={(event) =>
            setTweak("density", event.target.value as Tweaks["density"])
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="workspace-body-font">
          Authored content font
        </label>
        <select
          id="workspace-body-font"
          className="input settings-compact-select"
          value={tweaks.bodyfont}
          onChange={(event) =>
            setTweak("bodyfont", event.target.value as Tweaks["bodyfont"])
          }
        >
          <option value="sans">System sans serif</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospaced</option>
        </select>
        <div className="settings-field-hint">
          Applies to authored page content. The application interface always
          uses the macOS system font.
        </div>
      </div>

      {skins.length > 0 && (
        <div className="settings-field">
          <label className="settings-field-label" htmlFor="workspace-skin">
            Custom skin
          </label>
          <select
            id="workspace-skin"
            className="input settings-compact-select"
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
        </div>
      )}
    </>
  );
}
