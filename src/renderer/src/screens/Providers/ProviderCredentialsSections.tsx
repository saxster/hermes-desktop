import { PROVIDERS, SETTINGS_SECTIONS } from "../../constants";
import BrandLogo from "../../components/common/BrandLogo";
import { useI18n } from "../../components/useI18n";

export type ProviderSetup = (typeof PROVIDERS.setup)[number];

export interface ProviderTestResult {
  type: "success" | "error";
  message: string;
}

export function providerSetupForEnvKey(
  envKey: string,
): ProviderSetup | undefined {
  return PROVIDERS.setup.find((provider) => provider.envKey === envKey);
}

export function ProviderCredentialsSections(props: {
  env: Record<string, string>;
  savedKey: string | null;
  visibleKeys: Set<string>;
  testingProviderKey: string | null;
  providerTestResults: Record<string, ProviderTestResult>;
  setInputRef: (key: string, node: HTMLInputElement | null) => void;
  onChange: (key: string, value: string) => void;
  onBlur: (key: string) => void;
  onToggleVisibility: (key: string) => void;
  onAddKey: (key: string) => void;
  onRemoveKey: (key: string) => void;
  onTestProvider: (key: string, setup: ProviderSetup | undefined) => void;
  onUseProvider: (setup: ProviderSetup | undefined) => void;
  isSetupActive: (setup: ProviderSetup | undefined) => boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  return (
    <>
      {SETTINGS_SECTIONS.map((section) => {
        const isLlmProviders =
          section.title === "constants.sectionLlmProviders";
        return (
          <div key={section.title} className="settings-section">
            <div className="settings-section-title">{t(section.title)}</div>
            <div className={isLlmProviders ? "provider-keys-grid" : undefined}>
              {section.items.map((field) => {
                const setup = providerSetupForEnvKey(field.key);
                const hasKey = Boolean(props.env[field.key]?.trim());
                const isActive = props.isSetupActive(setup);
                const testResult = props.providerTestResults[field.key];

                return (
                  <div
                    key={field.key}
                    className={
                      isLlmProviders ? "provider-key-card" : "settings-field"
                    }
                  >
                    {isLlmProviders && (
                      <>
                        <div className="provider-key-card-head">
                          <BrandLogo provider={setup?.id || field.key} size={22} />
                          <span className="provider-key-card-title">
                            {t(field.label)}
                          </span>
                          {props.savedKey === field.key && (
                            <span className="settings-saved">
                              {t("common.saved")}
                            </span>
                          )}
                        </div>
                        <div className="provider-card-status-row">
                          {isActive && (
                            <span className="provider-status-pill provider-status-active">
                              {t("providers.status.activeModel")}
                            </span>
                          )}
                          <span
                            className={`provider-status-pill ${
                              hasKey
                                ? "provider-status-success"
                                : "provider-status-warning"
                            }`}
                          >
                            {hasKey
                              ? t("providers.status.apiKeySaved")
                              : t("providers.status.missingCredential")}
                          </span>
                        </div>
                      </>
                    )}
                    {!isLlmProviders && (
                      <label className="settings-field-label">
                        {t(field.label)}
                        {props.savedKey === field.key && (
                          <span className="settings-saved">
                            {t("common.saved")}
                          </span>
                        )}
                      </label>
                    )}
                    <div className="settings-input-row">
                      <input
                        ref={(node) => props.setInputRef(field.key, node)}
                        className="input"
                        type={
                          field.type === "password" &&
                          !props.visibleKeys.has(field.key)
                            ? "password"
                            : "text"
                        }
                        value={props.env[field.key] || ""}
                        onChange={(event) =>
                          props.onChange(field.key, event.target.value)
                        }
                        onBlur={() => props.onBlur(field.key)}
                        placeholder={t(field.label)}
                      />
                      {field.type === "password" && (
                        <button
                          className="btn-ghost settings-toggle-btn"
                          onClick={() => props.onToggleVisibility(field.key)}
                        >
                          {props.visibleKeys.has(field.key)
                            ? t("common.hide")
                            : t("common.show")}
                        </button>
                      )}
                    </div>
                    <div className="settings-field-hint">{t(field.hint)}</div>
                    {isLlmProviders && (
                      <>
                        <div className="provider-key-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => props.onAddKey(field.key)}
                          >
                            {t("providers.status.addKey")}
                          </button>
                          {hasKey && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              aria-label={`${t("settings.remove")} ${t(field.label)}`}
                              onClick={() => props.onRemoveKey(field.key)}
                            >
                              {t("settings.remove")}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={
                              !setup ||
                              !hasKey ||
                              props.testingProviderKey === field.key
                            }
                            onClick={() => props.onTestProvider(field.key, setup)}
                          >
                            {props.testingProviderKey === field.key
                              ? t("providers.status.testing")
                              : t("providers.status.test")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={!setup || isActive}
                            onClick={() => props.onUseProvider(setup)}
                          >
                            {t("providers.status.use")}
                          </button>
                        </div>
                        {testResult && (
                          <div
                            className={`provider-test-result provider-test-${testResult.type}`}
                          >
                            {testResult.message}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
