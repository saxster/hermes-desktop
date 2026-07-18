import { useState, useEffect, useRef } from "react";
import { useI18n } from "../../components/useI18n";
import type {
  ProviderSetup,
  ProviderTestResult,
} from "./ProviderCredentialsSections";

/**
 * Provider API-key (.env) state and handlers for the Providers screen:
 * per-key debounced auto-save (issue #236), unmount flush, visibility
 * toggles, and model-discovery key tests. Extracted from Providers.tsx —
 * behavior preserved verbatim.
 */
export function useProviderEnv(profile: string | undefined): {
  env: Record<string, string>;
  savedKey: string | null;
  visibleKeys: Set<string>;
  testingProviderKey: string | null;
  providerTestResults: Record<string, ProviderTestResult>;
  setInputRef: (key: string, node: HTMLInputElement | null) => void;
  handleChange: (key: string, value: string) => void;
  handleBlur: (key: string) => Promise<void>;
  toggleVisibility: (key: string) => void;
  handleAddKey: (key: string) => Promise<void>;
  handleRemoveKey: (key: string) => Promise<void>;
  handleTestProvider: (
    key: string,
    setup: ProviderSetup | undefined,
  ) => Promise<void>;
} {
  const { t } = useI18n();
  const [env, setEnv] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());
  const [testingProviderKey, setTestingProviderKey] = useState<string | null>(
    null,
  );
  const [providerTestResults, setProviderTestResults] = useState<
    Record<string, ProviderTestResult>
  >({});
  const keyInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  // Per-key debounce timers for env auto-save on change. Previously env
  // values were persisted only on input blur, so users who clicked the
  // model dropdown (triggering the model-config auto-save) without first
  // blurring the API key input lost their typed key — config.yaml
  // updated but .env didn't. Issue #236. The on-blur handler stays as a
  // "flush immediately" fast path; the debounce here catches the
  // change-but-no-blur case.
  const envSaveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  // Mirror of `env` state, kept in a ref so the unmount cleanup can read
  // the latest value when flushing pending debounces (a closure over
  // `env` directly would capture a stale snapshot).
  const envRef = useRef<Record<string, string>>({});

  useEffect(() => {
    window.hermesAPI
      .getEnv(profile)
      .then(setEnv)
      .catch((err: unknown) => {
        console.error("Failed to load provider keys:", err);
      });
  }, [profile]);

  async function handleBlur(key: string): Promise<void> {
    // Cancel any pending debounced save for this key — the blur handler
    // is a faster flush path with the "Saved" indicator.
    const pending = envSaveTimers.current.get(key);
    if (pending) {
      clearTimeout(pending);
      envSaveTimers.current.delete(key);
    }
    const value = env[key] || "";
    await window.hermesAPI.setEnv(key, value, profile);
    setSavedKey(key);
    setTimeout(() => setSavedKey(null), 2000);
  }

  function handleChange(key: string, value: string): void {
    setEnv((prev) => ({ ...prev, [key]: value }));

    // Persist the typed value on change (debounced 400ms) so users who
    // navigate away — or trigger the model-config auto-save by changing
    // the provider dropdown — don't lose what they typed if they never
    // explicitly blurred the input. Matches the model config's
    // auto-save behavior; resolves the asymmetry behind issue #236.
    const pending = envSaveTimers.current.get(key);
    if (pending) clearTimeout(pending);
    const timer = setTimeout(() => {
      envSaveTimers.current.delete(key);
      void window.hermesAPI.setEnv(key, value, profile);
    }, 400);
    envSaveTimers.current.set(key, timer);
  }

  // Keep envRef in sync with the latest env state so the unmount
  // cleanup below can read it without stale-closure issues.
  useEffect(() => {
    envRef.current = env;
  }, [env]);

  useEffect(() => {
    // On unmount, flush any pending debounced env writes synchronously
    // (fire-and-forget — the IPC handler in the main process completes
    // regardless of React lifecycle). Without this, typing an API key
    // and immediately navigating away within the debounce window would
    // lose the typed value, exactly the original bug.
    const timers = envSaveTimers.current;
    return () => {
      for (const [key, timer] of timers) {
        clearTimeout(timer);
        window.hermesAPI
          .setEnv(key, envRef.current[key] || "", profile)
          .catch((err: unknown) => {
            console.error(`Failed to flush provider key ${key}:`, err);
          });
      }
      timers.clear();
    };
  }, [profile]);

  async function handleAddKey(fieldKey: string): Promise<void> {
    const value = env[fieldKey]?.trim();
    if (!value) {
      keyInputRefs.current.get(fieldKey)?.focus();
      return;
    }
    await handleBlur(fieldKey);
  }

  async function handleRemoveKey(fieldKey: string): Promise<void> {
    const pending = envSaveTimers.current.get(fieldKey);
    if (pending) {
      clearTimeout(pending);
      envSaveTimers.current.delete(fieldKey);
    }
    await window.hermesAPI.setEnv(fieldKey, "", profile);
    setEnv((prev) => ({ ...prev, [fieldKey]: "" }));
    setProviderTestResults((prev) => {
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    setSavedKey(fieldKey);
    setTimeout(() => setSavedKey(null), 2000);
  }

  async function handleTestProvider(
    fieldKey: string,
    setup: ProviderSetup | undefined,
  ): Promise<void> {
    const apiKey = env[fieldKey]?.trim();
    if (!apiKey) {
      setProviderTestResults((prev) => ({
        ...prev,
        [fieldKey]: {
          type: "error",
          message: t("providers.status.missingCredential"),
        },
      }));
      keyInputRefs.current.get(fieldKey)?.focus();
      return;
    }
    if (!setup) {
      setProviderTestResults((prev) => ({
        ...prev,
        [fieldKey]: {
          type: "error",
          message: t("providers.status.testUnsupported"),
        },
      }));
      return;
    }

    setTestingProviderKey(fieldKey);
    try {
      const result = await window.hermesAPI.discoverProviderModels(
        setup.configProvider || setup.id,
        setup.baseUrl || undefined,
        apiKey,
        profile,
      );
      if (result.status === "ok") {
        setProviderTestResults((prev) => ({
          ...prev,
          [fieldKey]: {
            type: "success",
            message: t("providers.status.testOk", {
              count: result.models.length,
            }),
          },
        }));
      } else {
        const key =
          result.status === "no-key"
            ? "providers.status.testNoKey"
            : result.status === "unknown-host"
              ? "providers.status.testUnknownHost"
              : "providers.status.testUnsupported";
        setProviderTestResults((prev) => ({
          ...prev,
          [fieldKey]: { type: "error", message: t(key) },
        }));
      }
    } catch (err) {
      setProviderTestResults((prev) => ({
        ...prev,
        [fieldKey]: {
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : t("providers.status.testFailed"),
        },
      }));
    } finally {
      setTestingProviderKey(null);
    }
  }

  function toggleVisibility(key: string): void {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setInputRef(key: string, node: HTMLInputElement | null): void {
    if (node) keyInputRefs.current.set(key, node);
    else keyInputRefs.current.delete(key);
  }

  return {
    env,
    savedKey,
    visibleKeys,
    testingProviderKey,
    providerTestResults,
    setInputRef,
    handleChange,
    handleBlur,
    toggleVisibility,
    handleAddKey,
    handleRemoveKey,
    handleTestProvider,
  };
}
