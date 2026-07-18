import { useState, useEffect, useRef, useCallback } from "react";
import { useI18n } from "../../components/useI18n";
import { getDevMode, setDevMode } from "../../lib/devMode";
import { LearningSurface } from "../SpsAgent/learning/LearningSurface";
import {
  generateApiServerKey,
  getApiServerKeyStatus,
  getConnectionConfig,
  saveConnectionConfig,
  saveSshConfig,
  testRemoteConnection,
  testSshConnection,
} from "../../lib/api/connection";
import { getConfigValue, setConfigValue } from "../../lib/api/config";

// Build a mask string the same width as the stored API key so the
// "saved" state of the input looks like a key, not a constant blob.
// Length is exposed by the main process via PublicConnectionConfig.
// 0 falls back to 8 dots so the user gets a visible "set" indicator
// even if main didn't report a length yet. Capped to keep absurdly
// long keys from blowing up the field.
function makeApiKeyMask(length: number): string {
  const n = Math.min(Math.max(length, 8), 128);
  return "*".repeat(n);
}

export function SettingsAdvanced({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [devModeOn, setDevModeOn] = useState(getDevMode());

  // Connection mode
  const [connMode, setConnMode] = useState<"local" | "remote" | "ssh">("local");
  const [connRemoteUrl, setConnRemoteUrl] = useState("");
  const [connApiKey, setConnApiKey] = useState("");
  const [connApiKeyMask, setConnApiKeyMask] = useState("");
  const [connHasApiKey, setConnHasApiKey] = useState(false);
  const [connTesting, setConnTesting] = useState(false);
  const [connStatus, setConnStatus] = useState<string | null>(null);
  const connLoaded = useRef(false);
  const [apiServerKeyMissing, setApiServerKeyMissing] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  // SSH connection state
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [sshUser, setSshUser] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshRemotePort, setSshRemotePort] = useState("");

  // Network settings
  const [forceIpv4, setForceIpv4] = useState(false);
  const [httpProxy, setHttpProxy] = useState("");
  const [networkSaved, setNetworkSaved] = useState(false);

  const loadConfig = useCallback(async (): Promise<void> => {
    // Load fast config first (cached in main process)
    const [conn, keyStatus] = await Promise.all([
      getConnectionConfig(),
      getApiServerKeyStatus(profile),
    ]);
    setConnMode(conn.mode);
    setConnRemoteUrl(conn.remoteUrl);
    setConnHasApiKey(conn.hasApiKey);
    const mask = conn.hasApiKey ? makeApiKeyMask(conn.apiKeyLength) : "";
    setConnApiKeyMask(mask);
    setConnApiKey(mask);
    setSshHost(conn.ssh?.host || "");
    setSshPort(conn.ssh?.port ? String(conn.ssh.port) : "");
    setSshUser(conn.ssh?.username || "");
    setSshKeyPath(conn.ssh?.keyPath || "");
    setSshRemotePort(conn.ssh?.remotePort ? String(conn.ssh.remotePort) : "");
    setApiServerKeyMissing(!keyStatus.hasKey);
    connLoaded.current = true;

    // Load network settings from config.yaml
    getConfigValue("network.force_ipv4", profile).then((v) => {
      setForceIpv4(v === "true" || v === "True");
    });
    getConfigValue("network.proxy", profile).then((v) => {
      setHttpProxy(v || "");
    });
  }, [profile]);

  useEffect(() => {
    Promise.resolve()
      .then(loadConfig)
      .catch((err: unknown) => {
        console.error("Failed to load settings:", err);
      });
  }, [loadConfig]);

  function getConnectionApiKeyForSave(): string | undefined {
    // Mask sentinel in the field means "the secret is still server-side
    // and the user hasn't touched it" — always preserve the stored key.
    // The old code wiped the key whenever the URL changed, so a one-
    // character URL edit (fix typo, add /v1) silently dropped the saved
    // credential. To clear the key, the user must explicitly erase the
    // field.
    if (connHasApiKey && connApiKey === connApiKeyMask) {
      return undefined;
    }
    return connApiKey.trim();
  }

  async function handleSaveConnection(): Promise<void> {
    if (connMode === "ssh") {
      await saveSshConfig(
        sshHost.trim(),
        parseInt(sshPort, 10) || 22,
        sshUser.trim(),
        sshKeyPath.trim(),
        parseInt(sshRemotePort, 10) || 8642,
        18642,
      );
    } else {
      const apiKey = getConnectionApiKeyForSave();
      await saveConnectionConfig(connMode, connRemoteUrl, apiKey);
      if (apiKey !== undefined) {
        const hasApiKey = apiKey.length > 0;
        setConnHasApiKey(hasApiKey);
        if (hasApiKey) {
          const mask = makeApiKeyMask(apiKey.length);
          setConnApiKeyMask(mask);
          setConnApiKey(mask);
        } else {
          setConnApiKeyMask("");
        }
      }
    }
    setConnStatus("Saved");
    setTimeout(() => setConnStatus(null), 2000);
  }

  async function handleTestConnection(): Promise<void> {
    if (connMode === "ssh") {
      if (!sshHost.trim() || !sshUser.trim()) {
        setConnStatus("Host and username are required");
        return;
      }
      setConnTesting(true);
      setConnStatus(null);
      const ok = await testSshConnection(
        sshHost.trim(),
        parseInt(sshPort, 10) || 22,
        sshUser.trim(),
        sshKeyPath.trim(),
        parseInt(sshRemotePort, 10) || 8642,
      );
      setConnTesting(false);
      setConnStatus(ok ? "SSH tunnel connected!" : "Could not connect via SSH");
    } else {
      const url = connRemoteUrl.trim();
      if (!url) {
        setConnStatus("Please enter a URL");
        return;
      }
      setConnTesting(true);
      setConnStatus(null);
      const ok = await testRemoteConnection(url, getConnectionApiKeyForSave());
      setConnTesting(false);
      setConnStatus(ok ? "Connected successfully!" : "Could not reach server");
    }
  }

  async function handleSwitchToLocal(): Promise<void> {
    setConnMode("local");
    setConnRemoteUrl("");
    setConnApiKey("");
    setConnApiKeyMask("");
    setConnHasApiKey(false);
    await saveConnectionConfig("local", "", "");
    setConnStatus(t("settings.switchedToLocal"));
    setTimeout(() => setConnStatus(null), 2000);
  }

  return (
    <>
      <div className="settings-section" data-section-tab="advanced">
        <div className="settings-section-title">
          {t("settings.connectionSection")}
          {connStatus && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {connStatus}
            </span>
          )}
        </div>

        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.connectionMode")}
          </label>
          <div className="settings-theme-options">
            <button
              className={`settings-theme-option ${connMode === "local" ? "active" : ""}`}
              onClick={() => {
                setConnMode("local");
                if (connLoaded.current) {
                  handleSwitchToLocal().catch((err: unknown) => {
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }
              }}
            >
              {t("settings.modeLocal")}
            </button>
            <button
              className={`settings-theme-option ${connMode === "remote" ? "active" : ""}`}
              onClick={() => setConnMode("remote")}
            >
              {t("settings.modeRemote")}
            </button>
            <button
              className={`settings-theme-option ${connMode === "ssh" ? "active" : ""}`}
              onClick={() => setConnMode("ssh")}
            >
              SSH Tunnel
            </button>
          </div>
          <div className="settings-field-hint">
            {connMode === "local"
              ? t("settings.modeLocalHint")
              : connMode === "ssh"
                ? "Tunnel to a remote SPS service over SSH — no exposed ports or API keys needed."
                : t("settings.modeRemoteHint")}
          </div>
        </div>

        {!apiServerKeyMissing ? null : connMode === "local" ? (
          <div className="settings-api-key-banner">
            <div className="settings-api-key-banner-title">
              Session history disabled — <code>API_SERVER_KEY</code> not set
            </div>
            <div className="settings-api-key-banner-desc">
              Without an API server key the connection service cannot
              authenticate session continuation requests. Messages will still
              send, but conversation history won&apos;t be preserved across
              restarts.
            </div>
            <button
              className="btn btn-primary"
              disabled={generatingKey}
              onClick={() => {
                setGeneratingKey(true);
                generateApiServerKey(profile)
                  .then(() => {
                    setApiServerKeyMissing(false);
                    setConnStatus(
                      "API key generated — connection service restarting…",
                    );
                    setTimeout(() => setConnStatus(null), 4000);
                  })
                  .catch((err: unknown) => {
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  })
                  .finally(() => setGeneratingKey(false));
              }}
            >
              {generatingKey ? "Generating…" : "Generate & save a key for me"}
            </button>
          </div>
        ) : (
          <div className="settings-api-key-banner settings-api-key-banner--info">
            <div className="settings-api-key-banner-title">
              Set <code>API_SERVER_KEY</code> on the remote server
            </div>
            <div className="settings-api-key-banner-desc">
              {connMode === "ssh"
                ? "SSH mode: add API_SERVER_KEY=<your-key> to ~/.hermes/profiles/<profile>/.env on the remote host, then restart the connection service there."
                : "Remote mode: add API_SERVER_KEY=<your-key> to the .env on your remote SPS service, then restart the connection service."}
            </div>
          </div>
        )}

        {connMode === "remote" && (
          <>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.remoteUrl")}
              </label>
              <input
                className="input"
                type="url"
                value={connRemoteUrl}
                onChange={(e) => setConnRemoteUrl(e.target.value)}
                placeholder="http://192.168.1.100:8642"
                onBlur={() => {
                  handleSaveConnection().catch((err: unknown) => {
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }}
              />
              <div className="settings-field-hint">
                {t("settings.remoteUrlHint")}
              </div>
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                {t("settings.remoteApiKey")}
              </label>
              <input
                className="input"
                type="password"
                value={connApiKey}
                onChange={(e) => setConnApiKey(e.target.value)}
                onFocus={(e) => {
                  if (connApiKey === connApiKeyMask) {
                    e.currentTarget.select();
                  }
                }}
                placeholder={t("settings.remoteApiKey")}
                onBlur={() => {
                  handleSaveConnection().catch((err: unknown) => {
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }}
              />
              <div className="settings-field-hint">
                {t("settings.remoteApiKeyHint")}
              </div>
            </div>
            <div className="settings-hermes-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  handleTestConnection().catch((err: unknown) => {
                    setConnTesting(false);
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }}
                disabled={connTesting}
              >
                {connTesting
                  ? t("settings.testingConnection")
                  : t("settings.testConnection")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  handleSaveConnection().catch((err: unknown) => {
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }}
              >
                {t("settings.save")}
              </button>
            </div>
          </>
        )}

        {connMode === "ssh" && (
          <>
            <div className="settings-field">
              <label className="settings-field-label">SSH Host</label>
              <input
                className="input"
                type="text"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
                placeholder="192.168.1.100 or myserver.local"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">SSH Port</label>
              <input
                className="input"
                type="number"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
                placeholder="22"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">Username</label>
              <input
                className="input"
                type="text"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
                placeholder="hermes"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                Private Key Path{" "}
                <span style={{ fontWeight: 400, opacity: 0.6 }}>
                  (optional, defaults to ~/.ssh/id_rsa)
                </span>
              </label>
              <input
                className="input"
                type="text"
                value={sshKeyPath}
                onChange={(e) => setSshKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
              />
            </div>
            <div className="settings-field">
              <label className="settings-field-label">
                Remote Hermes Port{" "}
                <span style={{ fontWeight: 400, opacity: 0.6 }}>
                  (default 8642)
                </span>
              </label>
              <input
                className="input"
                type="number"
                value={sshRemotePort}
                onChange={(e) => setSshRemotePort(e.target.value)}
                placeholder="8642"
              />
              <div className="settings-field-hint">
                Make sure you can run{" "}
                <code style={{ fontFamily: "monospace" }}>
                  ssh {sshUser || "user"}@{sshHost || "host"}
                </code>{" "}
                without a password prompt. The first connection trusts the host
                key and stores it in{" "}
                <code style={{ fontFamily: "monospace" }}>
                  ~/.ssh/known_hosts
                </code>
                ; SSH will fail closed if that key changes later.
              </div>
            </div>
            <div className="settings-hermes-actions">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  handleTestConnection().catch((err: unknown) => {
                    setConnTesting(false);
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }}
                disabled={connTesting}
              >
                {connTesting ? "Testing SSH…" : "Test SSH Connection"}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  handleSaveConnection().catch((err: unknown) => {
                    setConnStatus(
                      err instanceof Error ? err.message : String(err),
                    );
                  });
                }}
              >
                {t("settings.save")}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="settings-section" data-section-tab="advanced">
        <div className="settings-section-title">Learning developer tools</div>
        <LearningSurface profile={profile} developerOnly />
      </div>

      <div className="settings-section" data-section-tab="advanced">
        <div className="settings-section-title">Developer mode</div>
        <div className="settings-field">
          <label className="settings-field-label">
            Show developer controls in chat
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={devModeOn}
                onChange={(e) => {
                  const val = e.target.checked;
                  setDevModeOn(val);
                  setDevMode(val);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            Reveals the worktree panel and filesystem checkpoint controls in the
            Chat header. Off by default — tool use itself is always available.
          </div>
        </div>
      </div>

      <div className="settings-section" data-section-tab="advanced">
        <div className="settings-section-title">
          {t("settings.networkSection")}
          {networkSaved && (
            <span className="settings-saved" style={{ marginLeft: 8 }}>
              {t("settings.saved")}
            </span>
          )}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.forceIpv4")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={forceIpv4}
                onChange={(e) => {
                  const val = e.target.checked;
                  setForceIpv4(val);
                  setConfigValue(
                    "network.force_ipv4",
                    val ? "true" : "false",
                    profile,
                  )
                    .then(() => {
                      setNetworkSaved(true);
                      setTimeout(() => setNetworkSaved(false), 2000);
                    })
                    .catch((err: unknown) => {
                      setForceIpv4(!val);
                      console.error("Failed to save IPv4 setting:", err);
                    });
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.forceIpv4Hint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.httpProxy")}
          </label>
          <input
            className="input"
            type="text"
            value={httpProxy}
            onChange={(e) => setHttpProxy(e.target.value)}
            onBlur={() => {
              setConfigValue("network.proxy", httpProxy.trim(), profile)
                .then(() => {
                  setNetworkSaved(true);
                  setTimeout(() => setNetworkSaved(false), 2000);
                })
                .catch((err: unknown) => {
                  console.error("Failed to save proxy setting:", err);
                });
            }}
            placeholder={t("settings.proxyPlaceholder")}
          />
          <div className="settings-field-hint">
            {t("settings.httpProxyHint")}
          </div>
        </div>
      </div>

      {connMode === "remote" && (
        <div className="settings-section" data-section-tab="advanced">
          <div className="settings-section-title">
            {t("settings.serverConfigTitle")}
          </div>
          <div
            className="settings-field-hint"
            dangerouslySetInnerHTML={{ __html: t("settings.serverConfigHint") }}
          />
        </div>
      )}
    </>
  );
}
