// lib/api/connection.ts — the renderer's single import seam for the
// connection domain (local / remote / SSH gateway connectivity).
//
// Data-access layer (seed): today these are deliberate pass-throughs to
// window.hermesAPI — the value is the SEAM. Components import the domain,
// not the global, so the domain's IPC surface is greppable in one place and
// error normalization / caching / connection-mode branching has exactly one
// home when it becomes needed. New connection call sites MUST be added here
// first, then imported. See docs/REFACTOR-AUDIT-2026-07-18.md §2.
//
// First migrated consumer: screens/Settings/SettingsAdvanced.tsx.

export type ConnectionMode = "local" | "remote" | "ssh";

export function getConnectionConfig(): ReturnType<
  Window["hermesAPI"]["getConnectionConfig"]
> {
  return window.hermesAPI.getConnectionConfig();
}

export function saveConnectionConfig(
  mode: ConnectionMode,
  remoteUrl: string,
  apiKey?: string,
): ReturnType<Window["hermesAPI"]["setConnectionConfig"]> {
  return window.hermesAPI.setConnectionConfig(mode, remoteUrl, apiKey);
}

export function testRemoteConnection(
  url: string,
  apiKey?: string,
): ReturnType<Window["hermesAPI"]["testRemoteConnection"]> {
  return window.hermesAPI.testRemoteConnection(url, apiKey);
}

export function saveSshConfig(
  host: string,
  port: number,
  username: string,
  keyPath: string,
  remotePort: number,
  localPort: number,
): ReturnType<Window["hermesAPI"]["setSshConfig"]> {
  return window.hermesAPI.setSshConfig(
    host,
    port,
    username,
    keyPath,
    remotePort,
    localPort,
  );
}

export function testSshConnection(
  host: string,
  port: number,
  username: string,
  keyPath: string,
  remotePort: number,
): ReturnType<Window["hermesAPI"]["testSshConnection"]> {
  return window.hermesAPI.testSshConnection(
    host,
    port,
    username,
    keyPath,
    remotePort,
  );
}

export function getApiServerKeyStatus(
  profile?: string,
): ReturnType<Window["hermesAPI"]["getApiServerKeyStatus"]> {
  return window.hermesAPI.getApiServerKeyStatus(profile);
}

export function generateApiServerKey(
  profile?: string,
): ReturnType<Window["hermesAPI"]["generateApiServerKey"]> {
  return window.hermesAPI.generateApiServerKey(profile);
}
