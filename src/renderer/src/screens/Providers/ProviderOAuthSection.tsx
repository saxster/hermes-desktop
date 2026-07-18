import { useState, useEffect, useCallback } from "react";
import { OAUTH_PROVIDERS } from "../../constants";
import { useI18n } from "../../components/useI18n";
import BrandLogo from "../../components/common/BrandLogo";
import OAuthLoginModal from "../../components/OAuthLoginModal";
import { KeyRound } from "../../assets/icons";

type OAuthProviderStatus = {
  provider: string;
  signedIn: boolean;
  source: "providers" | "credential_pool" | null;
};

/**
 * The OAuth providers section: sign-in cards, local sign-out, "use as
 * active model", and the OAuth login modal. Reads `modelProvider` from
 * the parent (for the active pill) and reports "Use" via `onUseProvider`.
 */
export function ProviderOAuthSection({
  profile,
  visible,
  modelProvider,
  onUseProvider,
}: {
  profile?: string;
  visible?: boolean;
  modelProvider: string;
  onUseProvider: (provider: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  // OAuth sign-in modal — holds the provider def being authenticated.
  const [oauthModal, setOauthModal] = useState<
    (typeof OAUTH_PROVIDERS)[number] | null
  >(null);
  const [oauthStatuses, setOauthStatuses] = useState<
    Record<string, OAuthProviderStatus>
  >({});
  const [oauthMessages, setOauthMessages] = useState<Record<string, string>>(
    {},
  );

  const fetchOAuthStatuses = useCallback(async (): Promise<
    Record<string, OAuthProviderStatus>
  > => {
    const statuses = await Promise.all(
      OAUTH_PROVIDERS.map(async (provider) => {
        try {
          return [
            provider.id,
            await window.hermesAPI.getOAuthProviderStatus(provider.id, profile),
          ] as const;
        } catch {
          return [
            provider.id,
            { provider: provider.id, signedIn: false, source: null },
          ] as const;
        }
      }),
    );
    return Object.fromEntries(statuses);
  }, [profile]);

  useEffect(() => {
    fetchOAuthStatuses()
      .then(setOauthStatuses)
      .catch((err: unknown) => {
        console.error("Failed to load OAuth statuses:", err);
      });
  }, [fetchOAuthStatuses]);

  // Refresh statuses when the screen becomes visible
  useEffect(() => {
    if (!visible) return;
    fetchOAuthStatuses()
      .then(setOauthStatuses)
      .catch((err: unknown) => {
        console.error("Failed to refresh OAuth statuses:", err);
      });
  }, [visible, fetchOAuthStatuses]);

  async function refreshOAuthStatuses(): Promise<void> {
    setOauthStatuses(await fetchOAuthStatuses());
  }

  async function handleOAuthSignOut(provider: string): Promise<void> {
    await window.hermesAPI.removeOAuthProviderCredentials(provider, profile);
    setOauthMessages((prev) => ({
      ...prev,
      [provider]: t("providers.oauth.localSignOutComplete"),
    }));
    await refreshOAuthStatuses();
  }

  return (
    <>
      <div className="settings-section">
        <div className="settings-section-title">
          {t("providers.oauth.sectionTitle")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("providers.oauth.sectionHint")}
        </div>
        <div className="provider-keys-grid">
          {OAUTH_PROVIDERS.map((p) => {
            const status = oauthStatuses[p.id];
            const signedIn = Boolean(status?.signedIn);
            const isActive = modelProvider === p.id;

            return (
              <div key={p.id} className="provider-key-card">
                <div className="provider-key-card-head">
                  <BrandLogo provider={p.id} size={22} />
                  <span className="provider-key-card-title">{p.name}</span>
                </div>
                <div className="provider-card-status-row">
                  {isActive && (
                    <span className="provider-status-pill provider-status-active">
                      {t("providers.status.activeModel")}
                    </span>
                  )}
                  <span
                    className={`provider-status-pill ${
                      signedIn
                        ? "provider-status-success"
                        : "provider-status-warning"
                    }`}
                  >
                    {signedIn
                      ? t("providers.status.signedIn")
                      : t("providers.status.missingCredential")}
                  </span>
                </div>
                <div className="settings-field-hint">{t(p.desc)}</div>
                {signedIn && (
                  <div className="settings-field-hint">
                    {t("providers.oauth.localSignOutHint")}
                  </div>
                )}
                <div className="provider-key-actions">
                  {!signedIn && (
                    <button
                      className="btn btn-secondary btn-sm oauth-signin-btn"
                      aria-label={`${t("providers.oauth.signIn")} — ${p.name}`}
                      onClick={() => setOauthModal(p)}
                    >
                      <KeyRound size={14} />
                      {t("providers.oauth.signIn")}
                    </button>
                  )}
                  {signedIn && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void handleOAuthSignOut(p.id)}
                    >
                      {t("providers.oauth.localSignOut")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!signedIn || isActive}
                    onClick={() => onUseProvider(p.id)}
                  >
                    {t("providers.status.use")}
                  </button>
                </div>
                {oauthMessages[p.id] && (
                  <div className="provider-test-result provider-test-success">
                    {oauthMessages[p.id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {oauthModal && (
        <OAuthLoginModal
          provider={oauthModal.id}
          providerLabel={oauthModal.name}
          profile={profile}
          onClose={() => {
            setOauthModal(null);
            refreshOAuthStatuses().catch((err: unknown) => {
              console.error("Failed to refresh OAuth status:", err);
            });
          }}
        />
      )}
    </>
  );
}
