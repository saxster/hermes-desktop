import { useState } from "react";
import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import { useDiscoveredModels } from "../../hooks/useDiscoveredModels";
import type { useModelConfig } from "./useModelConfig";

/**
 * The active-model section: provider select, model input with live
 * discovery autocomplete, and the custom base-URL field. Model state
 * lives in `useModelConfig` (parent) because credential and OAuth
 * sections also read/write the provider selection.
 */
export function ProviderModelSection({
  profile,
  visible,
  model,
}: {
  profile?: string;
  visible?: boolean;
  model: ReturnType<typeof useModelConfig>;
}): React.JSX.Element {
  const { t } = useI18n();
  const {
    modelProvider,
    setModelProvider,
    modelName,
    setModelName,
    modelBaseUrl,
    setModelBaseUrl,
    modelSaved,
  } = model;
  const isCustomProvider = modelProvider === "custom";

  // Live model discovery: fetch the provider's /v1/models list and feed
  // it into a datalist that powers the Model field's autocomplete.  Only
  // runs once the Providers tab is visible so we don't fire on every
  // background remount.
  const [discoveryRefresh, setDiscoveryRefresh] = useState(0);
  const discovery = useDiscoveredModels({
    provider: modelProvider,
    baseUrl: isCustomProvider ? modelBaseUrl : undefined,
    profile,
    enabled: !!visible && modelProvider !== "auto",
    refreshToken: discoveryRefresh,
  });
  const discoveryListId = "provider-model-discovery";

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        {t("common.model")}
        {modelSaved && (
          <span className="settings-saved" style={{ marginLeft: 8 }}>
            {t("common.saved")}
          </span>
        )}
      </div>

      <div className="settings-field">
        <label className="settings-field-label">{t("common.provider")}</label>
        <div className="settings-provider-row">
          <BrandLogo provider={modelProvider} modelId={modelName} size={20} />
          <select
            className="input settings-select"
            value={modelProvider}
            onChange={(e) => {
              const v = e.target.value;
              setModelProvider(v);
              if (v === "custom") {
                // Seed a local-LLM placeholder only when the field is empty
                // (don't clobber an existing custom URL the user has typed).
                if (!modelBaseUrl) {
                  setModelBaseUrl("http://localhost:1234/v1");
                }
              } else {
                // Switching to a named provider — its base_url is hardcoded
                // by the gateway, and a stale URL from a prior provider
                // would either be ignored (best case) or misroute (worst).
                setModelBaseUrl("");
              }
            }}
          >
            {PROVIDERS.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-field-hint">
          {isCustomProvider
            ? t("settings.customProviderHint")
            : t("settings.providerHint")}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label">{t("common.model")}</label>
        <div className="settings-model-row">
          <input
            className="input"
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder={t("settings.modelNamePlaceholder")}
            list={discovery.models.length > 0 ? discoveryListId : undefined}
            autoComplete="off"
          />
          {discovery.status !== "unsupported" &&
            discovery.status !== "idle" && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDiscoveryRefresh((n) => n + 1)}
                disabled={discovery.status === "loading"}
                title={t("settings.refreshModels")}
              >
                ↻
              </button>
            )}
        </div>
        {discovery.models.length > 0 && (
          <datalist id={discoveryListId}>
            {discovery.models.map((m) => {
              const isFree = discovery.freeModels?.includes(m);
              return (
                <option
                  key={m}
                  value={m}
                  label={isFree ? t("models.freeBadge") : undefined}
                />
              );
            })}
          </datalist>
        )}
        <div className="settings-field-hint">
          {discovery.status === "loading"
            ? t("settings.discoveringModels")
            : discovery.status === "ok"
              ? t("settings.discoveredCount", {
                  count: discovery.models.length,
                })
              : discovery.status === "no-key"
                ? t("settings.discoveryNoKey")
                : discovery.status === "error"
                  ? t("settings.discoveryError")
                  : t("settings.modelHint")}
        </div>
      </div>

      {isCustomProvider && (
        <div className="settings-field">
          <label className="settings-field-label">{t("common.baseUrl")}</label>
          <input
            className="input"
            type="text"
            value={modelBaseUrl}
            onChange={(e) => setModelBaseUrl(e.target.value)}
            placeholder={t("settings.modelBaseUrlPlaceholder")}
          />
          <div className="settings-field-hint">
            {t("settings.customBaseUrlHint")}
          </div>
        </div>
      )}
    </div>
  );
}
