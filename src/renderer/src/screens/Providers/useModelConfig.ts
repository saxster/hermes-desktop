import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Active model configuration (config.yaml): provider/model/baseUrl state,
 * initial load, refresh-on-visible, the 500 ms auto-save debounce, and the
 * 2 s Models-library persistence. Extracted from Providers.tsx — behavior
 * preserved verbatim, including the mount-time double load when `visible`
 * is already true (harmless, idempotent).
 */
export function useModelConfig(
  profile: string | undefined,
  visible: boolean | undefined,
): {
  modelProvider: string;
  setModelProvider: (value: string) => void;
  modelName: string;
  setModelName: (value: string) => void;
  modelBaseUrl: string;
  setModelBaseUrl: (value: string) => void;
  modelSaved: boolean;
} {
  const [modelProvider, setModelProvider] = useState("auto");
  const [modelName, setModelName] = useState("");
  const [modelBaseUrl, setModelBaseUrl] = useState("");
  const [modelSaved, setModelSaved] = useState(false);
  const modelLoaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modelLibTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadModelConfig = useCallback(async (): Promise<void> => {
    const mc = await window.hermesAPI.getModelConfig(profile);
    modelLoaded.current = false;
    setModelProvider(mc.provider);
    setModelName(mc.model);
    setModelBaseUrl(mc.baseUrl);
    requestAnimationFrame(() => {
      modelLoaded.current = true;
    });
  }, [profile]);

  useEffect(() => {
    modelLoaded.current = false;
    loadModelConfig().catch((err: unknown) => {
      console.error("Failed to load model config:", err);
    });
  }, [loadModelConfig]);

  // Refresh model config when the screen becomes visible
  useEffect(() => {
    if (!visible) return;
    loadModelConfig().catch((err: unknown) => {
      console.error("Failed to refresh model config:", err);
    });
  }, [visible, loadModelConfig]);

  // Auto-save the active model config (config.yaml) — debounced 500 ms so
  // typing in the Model field still feels responsive.
  const saveModelConfig = useCallback(async () => {
    if (!modelLoaded.current) return;
    await window.hermesAPI.setModelConfig(
      modelProvider,
      modelName,
      modelBaseUrl,
      profile,
    );
    setModelSaved(true);
    setTimeout(() => setModelSaved(false), 2000);
  }, [modelProvider, modelName, modelBaseUrl, profile]);

  useEffect(() => {
    if (!modelLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveModelConfig().catch((err: unknown) => {
        console.error("Failed to save model config:", err);
      });
    }, 500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [modelProvider, modelName, modelBaseUrl, saveModelConfig]);

  // Separately, persist the (provider, model) pair to the Models library
  // — but only after the user has been idle long enough that they've
  // plausibly finished typing the model name.  The active-save debounce
  // at 500 ms used to call `addModel` on every keystroke pause, leaving
  // dead intermediate entries ("deepseek-reaso", "deepseek-reason", …)
  // every time someone typed slowly.  2 s wait is enough for almost any
  // real edit while still landing the entry without an explicit Save click.
  useEffect(() => {
    if (!modelLoaded.current) return;
    if (!modelName.trim()) return;
    if (modelLibTimer.current) clearTimeout(modelLibTimer.current);
    modelLibTimer.current = setTimeout(() => {
      const displayName = modelName.split("/").pop() || modelName;
      window.hermesAPI
        .addModel(displayName, modelProvider, modelName, modelBaseUrl)
        .catch(() => {
          /* non-fatal — library write is best-effort */
        });
    }, 2000);
    return () => {
      if (modelLibTimer.current) clearTimeout(modelLibTimer.current);
    };
  }, [modelProvider, modelName, modelBaseUrl]);

  return {
    modelProvider,
    setModelProvider,
    modelName,
    setModelName,
    modelBaseUrl,
    setModelBaseUrl,
    modelSaved,
  };
}
