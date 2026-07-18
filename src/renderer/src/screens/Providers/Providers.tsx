import { useI18n } from "../../components/useI18n";
import { useModelConfig } from "./useModelConfig";
import { useProviderEnv } from "./useProviderEnv";
import { ProviderModelSection } from "./ProviderModelSection";
import { ProviderPoolSection } from "./ProviderPoolSection";
import { ProviderOAuthSection } from "./ProviderOAuthSection";
import { ProviderEngineOps } from "./ProviderEngineOps";
import {
  ProviderCredentialsSections,
  type ProviderSetup,
} from "./ProviderCredentialsSections";

/**
 * Providers screen composition root. Owns only the cross-section state:
 * the active model selection (written by credential and OAuth "Use"
 * actions via `useModelConfig`) and the .env key handlers
 * (`useProviderEnv`). Each section loads and manages its own slice.
 */
function Providers({
  profile,
  visible,
}: {
  profile?: string;
  visible?: boolean;
}): React.JSX.Element {
  const { t } = useI18n();
  const model = useModelConfig(profile, visible);
  const envApi = useProviderEnv(profile);

  function isSetupActive(setup: ProviderSetup | undefined): boolean {
    if (!setup) return false;
    const provider = setup.configProvider || setup.id;
    if (model.modelProvider !== provider) return false;
    if (provider === "custom")
      return model.modelBaseUrl === (setup.baseUrl || "");
    return true;
  }

  function handleUseProviderSetup(setup: ProviderSetup | undefined): void {
    if (!setup) return;
    model.setModelProvider(setup.configProvider || setup.id);
    model.setModelBaseUrl(setup.baseUrl || "");
  }

  function handleUseOAuthProvider(provider: string): void {
    model.setModelProvider(provider);
    model.setModelBaseUrl("");
  }

  return (
    <div className="settings-container">
      <h1 className="settings-header">{t("providers.title")}</h1>
      <p className="models-subtitle" style={{ marginBottom: 16 }}>
        {t("providers.subtitle")}
      </p>

      <ProviderModelSection profile={profile} visible={visible} model={model} />

      <ProviderPoolSection profile={profile} />

      <ProviderCredentialsSections
        env={envApi.env}
        savedKey={envApi.savedKey}
        visibleKeys={envApi.visibleKeys}
        testingProviderKey={envApi.testingProviderKey}
        providerTestResults={envApi.providerTestResults}
        setInputRef={envApi.setInputRef}
        onChange={envApi.handleChange}
        onBlur={(key) => void envApi.handleBlur(key)}
        onToggleVisibility={envApi.toggleVisibility}
        onAddKey={(key) => void envApi.handleAddKey(key)}
        onRemoveKey={(key) => void envApi.handleRemoveKey(key)}
        onTestProvider={(key, setup) =>
          void envApi.handleTestProvider(key, setup)
        }
        onUseProvider={handleUseProviderSetup}
        isSetupActive={isSetupActive}
      />

      <ProviderOAuthSection
        profile={profile}
        visible={visible}
        modelProvider={model.modelProvider}
        onUseProvider={handleUseOAuthProvider}
      />

      <ProviderEngineOps profile={profile} visible={visible} />
    </div>
  );
}

export default Providers;
