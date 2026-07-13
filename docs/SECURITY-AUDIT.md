# Security Audit — npm advisory baseline

This document records the project's current `npm audit` posture. The CI gate runs
`npm run audit:ci`, rejects every advisory that is not explicitly reviewed in
`security/npm-audit-allowlist.json`, and reports stale allowlist entries.

For app-level compatibility boundaries (network policy classes, calendar feed
tokens, CSP exceptions, updater trust chain, and shell compatibility), see
[`SECURITY-RESIDUALS.md`](./SECURITY-RESIDUALS.md).

Last reviewed: 2026-07-13 (Hermes Desktop 0.5.4).

## Current baseline

| Low | Moderate | High | Critical | Total |
| --- | -------- | ---- | -------- | ----- |
| 0   | 0        | 0    | 0        | **0** |

The allowlist is empty. No npm advisory is currently accepted as a residual.

The former 12-advisory transitive baseline was cleared on 2026-07-07 with scoped
dependency overrides. The changes kept the parent packages in place while moving
their vulnerable transitives to patched releases:

- `lodash-es` to `^4.18.1`.
- `nanoid@4` to `^5` under `@excalidraw/mermaid-to-excalidraw`.
- `vite` to `^7` under `@wesbos/code-icons`.

## Operational rules

- Do not add an allowlist entry merely to make CI green. Patch the dependency
  first; accept a residual only after documenting its reachability, impact, and
  why no compatible patch exists.
- Do not run `npm audit fix --force` without reviewing the proposed parent
  upgrades and verifying the React/Electron build.
- Run `npm run audit:ci` after dependency or lockfile changes. A zero result is
  the release expectation, not an informational metric.
