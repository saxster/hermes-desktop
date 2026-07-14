// SpsAgent.tsx — the screen wrapper that hosts the SPS Agent workspace inside a
// Hermes layout pane. Scopes the design system to a `.sps-scope` container, applies
// the current Tweaks to it, and hydrates the persisted workspace from the main
// process. Mount it only while the view is active (the zustand store is a module
// singleton, so workspace state survives unmount/remount).
import { useCallback, useEffect, useRef } from "react";
// Self-hosted fonts (Inter / JetBrains Mono / Source Serif 4) — same-origin so the
// desktop CSP allows them; replaces the prototype's blocked Google-Fonts @import.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/source-serif-4/500.css";
import "@fontsource/source-serif-4/600.css";
import "./styles/sps-tokens.css";
import "./styles/home.css";
import "./styles/notion.css";
import "./styles/v3.css";
import "./styles/ask.css";
import "./styles/equity.css";
import "./styles/tweaks.css";
import "./styles/health-rss.css";
import "./styles/deck-studio.css";
import "./screen.css";
import { App } from "./App";
import { useStore } from "./store";
import { hydrateWorkspace, startSpsStoreLifecycle } from "./store/lifecycle";
import { setThemeScope, applyTweaks, setSkinVars } from "./lib/theme";
import { skinToSpsVars } from "./lib/skin";
import { getActiveSkinId } from "../../utils/skin";
import { SystemThemeSync } from "./components/SystemThemeSync";
import { WorkspaceRecovery } from "./components/WorkspaceRecovery";
import { setStorageModeProfile } from "./lib/storageMode";

export function SpsAgent() {
  const scopeRef = useRef<HTMLDivElement>(null);
  const stopStoreLifecycleRef = useRef<(() => void) | null>(null);
  const workspaceLoadIssue = useStore((state) => state.workspaceLoadIssue);
  const resumeStoreLifecycle = useCallback(() => {
    stopStoreLifecycleRef.current ??= startSpsStoreLifecycle();
    useStore.getState().ocrResume();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setThemeScope(scopeRef.current);
    applyTweaks(useStore.getState().t);
    // Resume any OCR jobs persisted from a previous session once the workspace
    // is loaded (so OCR'd pages land in the real tree). No-op when idle.
    (async () => {
      // The main process defaults every SPS persistence API to the active
      // Hermes profile. Resolve that same profile before choosing whether its
      // blob or vault is authoritative; the mode itself is profile-scoped.
      let storageProfile = "default";
      try {
        const profiles = await window.hermesAPI.listProfiles();
        storageProfile =
          profiles.find((profile) => profile.isActive)?.name ?? "default";
      } catch {
        // Profile discovery is advisory at startup. Preserve the historical
        // default-profile path rather than leaving the workspace unhydrated.
      }
      if (cancelled) return;
      setStorageModeProfile(storageProfile);
      await hydrateWorkspace();
      if (cancelled || useStore.getState().workspaceLoadIssue) return;
      resumeStoreLifecycle();
    })().catch((error: unknown) => {
      console.error("Failed to initialize the SPS workspace:", error);
    });
    // Apply the active skin onto the SPS scope (idea A6 — fixes the regression
    // where skins targeted document root with Hermes var names). No-op in the
    // standalone web app where window.hermesAPI is absent.
    (async () => {
      try {
        const skins = await window.hermesAPI.listSkins();
        const active = skins.find((s) => s.id === getActiveSkinId());
        setSkinVars(skinToSpsVars(active?.skin ?? null));
      } catch {
        /* no bridge / no skins — leave tweaks-only theming */
      }
    })().catch((error: unknown) => {
      console.error("Failed to apply the active SPS skin:", error);
    });
    return () => {
      cancelled = true;
      useStore.getState().ocrStopScheduler();
      stopStoreLifecycleRef.current?.();
      stopStoreLifecycleRef.current = null;
      setThemeScope(null);
    };
  }, [resumeStoreLifecycle]);
  return (
    <div className="sps-scope" ref={scopeRef}>
      <SystemThemeSync />
      {workspaceLoadIssue ? (
        <WorkspaceRecovery onWorkspaceReady={resumeStoreLifecycle} />
      ) : (
        <App />
      )}
    </div>
  );
}

export default SpsAgent;
