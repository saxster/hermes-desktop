// lib/api/config.ts — the renderer's single import seam for free-form
// config.yaml key reads/writes (getConfig/setConfig). Same pass-through-seam
// contract as lib/api/connection.ts: import the domain, not the global.

export function getConfigValue(
  key: string,
  profile?: string,
): ReturnType<Window["hermesAPI"]["getConfig"]> {
  return window.hermesAPI.getConfig(key, profile);
}

export function setConfigValue(
  key: string,
  value: string,
  profile?: string,
): ReturnType<Window["hermesAPI"]["setConfig"]> {
  return window.hermesAPI.setConfig(key, value, profile);
}
