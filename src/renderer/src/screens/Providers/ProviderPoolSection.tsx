import { useState, useEffect } from "react";
import { PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import type { CredentialPoolEntry } from "../../../../shared/credentials";

/**
 * The credential-pool section: alternate keys per provider following the
 * upstream engine schema (issue #367). Fully self-contained — nothing
 * outside this section reads pool state.
 */
export function ProviderPoolSection({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  // Credential pool — entries follow the upstream engine schema
  // (issue #367). Old `{key, label}` entries are read tolerantly via
  // the optional `key` field on CredentialPoolEntry.
  const [credPool, setCredPool] = useState<
    Record<string, Array<CredentialPoolEntry>>
  >({});
  const [poolProvider, setPoolProvider] = useState("");
  const [poolNewKey, setPoolNewKey] = useState("");
  const [poolNewLabel, setPoolNewLabel] = useState("");

  useEffect(() => {
    window.hermesAPI
      .getCredentialPool(profile)
      .then(setCredPool)
      .catch((err: unknown) => {
        console.error("Failed to load credential pool:", err);
      });
  }, [profile]);

  async function handleAddPoolKey(): Promise<void> {
    if (!poolProvider || !poolNewKey.trim()) return;
    // Use the main-process helper which constructs the canonical
    // engine schema — `{id, label, auth_type, priority, source,
    // access_token, base_url, request_count}` — so the entry is
    // actually readable by the gateway's credential resolver. The
    // previous code wrote `{key, label}` which the engine couldn't
    // parse (issue #367).
    const updated = await window.hermesAPI.addCredentialPoolEntry(
      poolProvider,
      poolNewKey.trim(),
      poolNewLabel.trim(),
      profile,
    );
    setCredPool((prev) => ({ ...prev, [poolProvider]: updated }));
    setPoolNewKey("");
    setPoolNewLabel("");
  }

  async function handleRemovePoolKey(
    provider: string,
    index: number,
  ): Promise<void> {
    const entries = [...(credPool[provider] || [])];
    entries.splice(index, 1);
    await window.hermesAPI.setCredentialPool(provider, entries, profile);
    setCredPool((prev) => ({ ...prev, [provider]: entries }));
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        {t("settings.sections.credentialPool")}
      </div>
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("settings.poolHint")}
        </div>
        <div className="settings-pool-add">
          <select
            className="input"
            value={poolProvider}
            onChange={(e) => setPoolProvider(e.target.value)}
            style={{ width: 140 }}
          >
            <option value="">{t("common.provider")}</option>
            {PROVIDERS.options
              .filter((p) => p.value !== "auto")
              .map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.label)}
                </option>
              ))}
          </select>
          <input
            className="input"
            type="password"
            value={poolNewKey}
            onChange={(e) => setPoolNewKey(e.target.value)}
            placeholder={t("settings.apiKeyPlaceholder")}
            style={{ flex: 1 }}
          />
          <input
            className="input"
            type="text"
            value={poolNewLabel}
            onChange={(e) => setPoolNewLabel(e.target.value)}
            placeholder={t("settings.labelPlaceholder", {
              optional: t("common.optional"),
            })}
            style={{ width: 120 }}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              handleAddPoolKey().catch((err: unknown) => {
                console.error("Failed to add credential pool key:", err);
              });
            }}
            disabled={!poolProvider || !poolNewKey.trim()}
          >
            {t("settings.add")}
          </button>
        </div>
        {Object.entries(credPool).map(
          ([provider, entries]) =>
            entries.length > 0 && (
              <div key={provider} className="settings-pool-group">
                <div className="settings-pool-provider">
                  <BrandLogo provider={provider} size={16} />
                  {PROVIDERS.options.find((p) => p.value === provider)
                    ? t(
                        PROVIDERS.options.find((p) => p.value === provider)!
                          .label,
                      )
                    : provider}
                </div>
                {entries.map((entry, idx) => {
                  // Display the secret from whichever field this
                  // entry has — new entries use `access_token` per
                  // the engine schema (#367); old entries may still
                  // be in `key` (backward compat).
                  const secret =
                    entry.access_token || entry.api_key || entry.key || "";
                  return (
                    <div key={entry.id || idx} className="settings-pool-entry">
                      <span className="settings-pool-label">
                        {entry.label || `${t("settings.keyLabel")} ${idx + 1}`}
                      </span>
                      <span className="settings-pool-key">
                        {secret
                          ? `${secret.slice(0, 8)}...${secret.slice(-4)}`
                          : t("settings.empty")}
                      </span>
                      <button
                        className="btn-ghost"
                        style={{ color: "var(--error)", fontSize: 11 }}
                        onClick={() => {
                          handleRemovePoolKey(provider, idx).catch(
                            (err: unknown) => {
                              console.error(
                                "Failed to remove credential pool key:",
                                err,
                              );
                            },
                          );
                        }}
                      >
                        {t("settings.remove")}
                      </button>
                    </div>
                  );
                })}
              </div>
            ),
        )}
      </div>
    </div>
  );
}
