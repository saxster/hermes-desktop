# Hermes Desktop Roadmap Completion Audit - 2026-07-07

Branch: `codex/roadmap-phase0-note-index`

Implementation commit audited: `0d9a68249061f2f73d517fa062c45ae102e4d620`

Source plan: `ROADMAP.md`

## Summary

The roadmap implementation is committed and pushed to `origin/codex/roadmap-phase0-note-index`.
Local verification passed across lint, typecheck, Vitest, Electron-ABI note-index verification,
external-context verification, production build, and the SPS Playwright-Electron smoke. GitHub
Actions also passed on the fork branch after two CI-only test hermeticity fixes.
The remaining launchd lifecycle risk was reduced with a disposable LaunchAgent smoke that bootstraps,
runs, boots out, and cleans up a unique temporary user-agent label.

The implementation should not be called fully owner-shipped until the remaining external/manual gates
below are proven:

- Live owner-channel delivery is smoked with real configured owner channels, especially Telegram.

## Local Evidence

Commands run after the implementation and CI-hardening patches:

| Command                                                                                                                                                                                                                                     | Result                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/mobile-workspace-skill.test.ts`                                                                                                                                                                                       | Passed: 1 file, 3 tests.                                                                                                                            |
| `npx eslint src/main/mobile-workspace-skill.ts tests/mobile-workspace-skill.test.ts`                                                                                                                                                        | Passed.                                                                                                                                             |
| `TMPDIR=/private/tmp npx vitest run tests/newsroom-curator.test.ts tests/vault-semantic-search.test.ts`                                                                                                                                     | Passed: 2 files, 7 tests.                                                                                                                           |
| `TMPDIR=/private/tmp HERMES_NEWSROOM_CURATOR_SCRIPT=/private/tmp/missing-cluster.py HERMES_VAULT_SEMANTIC_SEARCH_SCRIPT=/private/tmp/missing-semantic.py npx vitest run tests/newsroom-curator.test.ts tests/vault-semantic-search.test.ts` | Passed: 2 files skipped, 7 tests skipped.                                                                                                           |
| `TMPDIR=/private/tmp npx vitest run tests/app-launcher.test.ts`                                                                                                                                                                             | Passed: 1 file, 8 tests.                                                                                                                            |
| `npx eslint tests/newsroom-curator.test.ts tests/vault-semantic-search.test.ts`                                                                                                                                                             | Passed.                                                                                                                                             |
| `npx eslint tests/app-launcher.test.ts`                                                                                                                                                                                                     | Passed.                                                                                                                                             |
| `node --check scripts/launchagent-smoke.mjs`                                                                                                                                                                                                | Passed.                                                                                                                                             |
| `npx eslint scripts/launchagent-smoke.mjs`                                                                                                                                                                                                  | Passed.                                                                                                                                             |
| `node scripts/launchagent-smoke.mjs`                                                                                                                                                                                                        | Passed: bootstrapped disposable label `com.nousresearch.hermes-scheduler.codex-smoke.33903` in `gui/501`, wrote marker, booted out, and cleaned up. |
| `test ! -e /private/tmp/hermes-launchagent-smoke-Eis4HE`                                                                                                                                                                                    | Passed: smoke temp directory was removed.                                                                                                           |
| `npm run lint`                                                                                                                                                                                                                              | Passed.                                                                                                                                             |
| `npm run typecheck`                                                                                                                                                                                                                         | Passed: node and web TypeScript projects.                                                                                                           |
| `npm test`                                                                                                                                                                                                                                  | Passed: 372 files, 2824 tests passed, 3 skipped.                                                                                                    |
| `npm run verify:note-index`                                                                                                                                                                                                                 | Passed: all note-index checks, including corrupt-cache self-heal.                                                                                   |
| `npm run verify:external-context`                                                                                                                                                                                                           | Passed: all external-context checks, including redaction and MCP roundtrip.                                                                         |
| `npm run build`                                                                                                                                                                                                                             | Passed with existing Vite dynamic-import warnings.                                                                                                  |
| `SMOKE_OUT=/private/tmp/hermes-sps-smoke node scripts/sps-smoke.mjs`                                                                                                                                                                        | Passed: 29 screenshots, `SMOKE_DONE`.                                                                                                               |
| `git diff --check`                                                                                                                                                                                                                          | Passed.                                                                                                                                             |

One validation artifact to avoid: running `npm run lint` in parallel with `npm run verify:note-index`
can race the verifier's transient `.verify-ni.cjs` file. Serial lint passed.

One local full-suite rerun timed out in `tests/capability-risk.test.ts` while full lint and Vitest
were running concurrently. The focused test passed on rerun, and the serial full `npm test` passed.

## GitHub Actions Evidence

Latest fork CI run before the LaunchAgent smoke harness was added:

- Run: `28878749010`
- URL: `https://github.com/saxster/hermes-desktop/actions/runs/28878749010`
- Event: `workflow_dispatch`
- Branch: `codex/roadmap-phase0-note-index`
- SHA: `0d9a68249061f2f73d517fa062c45ae102e4d620`
- Result: passed
- `check`: passed in 4m12s, including dependency install, audit, SBOM upload, typecheck, test, and lint.
- `verify-smoke`: passed in 2m26s, including build, note-index verification, external-context
  verification, and SPS smoke.

Earlier fork CI run `28877719443` proved `verify-smoke` but failed `check` because
`tests/app-launcher.test.ts` exercised macOS `/usr/bin/open` expectations on a Linux runner. That was
fixed by stubbing the intended macOS branch inside the test. The previous failed run
`28876554549` failed because two installed-skill integration tests assumed
`/Users/amar/.hermes/...`; those tests now use `homedir()` defaults, env overrides, and skip when the
external skill fixtures are not installed.

## Requirement Matrix

| Roadmap item                                    | Evidence                                                                                                                                                      | Status                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 0.1 Note-index self-healing                     | `src/main/note-index.ts`, `scripts/verify-note-index.ts`, `npm run verify:note-index`.                                                                        | Locally proven.                                                 |
| 0.2 Atomic writes everywhere                    | `src/main/utils.ts`, migrated persistence callers, `tests/safe-write-file-fsync.test.ts`, `tests/self-healing.test.ts`.                                       | Locally proven.                                                 |
| 0.3 SSH tunnel watchdog                         | `src/main/ssh-tunnel.ts`, `tests/ssh-tunnel.test.ts`, gateway restart coverage.                                                                               | Locally proven.                                                 |
| 0.4 Gateway hang and port conflict visibility   | `src/main/hermes/gateway-process.ts`, `src/main/gateway-ports.ts`, gateway tests.                                                                             | Locally proven.                                                 |
| 0.5 Aborted stream terminal callback            | `src/main/hermes/chat-client/api.ts`, `tests/chat-client-streaming.test.ts`.                                                                                  | Locally proven.                                                 |
| 0.6 Scheduled research `lastError`              | `src/main/scheduled-research.ts`, `tests/scheduled-research.test.ts`.                                                                                         | Locally proven.                                                 |
| 0.7 CI all tiers                                | `.github/workflows/ci.yml` includes `verify-smoke`; workflow dispatch run `28878749010` passed on fork branch SHA `0d9a68249061f2f73d517fa062c45ae102e4d620`. | Proven on GitHub Actions.                                       |
| 1.0 Plan checkbox reconciliation                | Updated superpowers plan docs.                                                                                                                                | Locally proven by path review.                                  |
| 1.1 Release-channel updates                     | `src/main/hermes-agent-updates.ts`, `tests/hermes-agent-update-check.test.ts`, update routine tests.                                                          | Locally proven with mocked GitHub release data.                 |
| 1.2 Live install-script refresh                 | `src/main/installer.ts`, `tests/installer-script-refresh.test.ts`.                                                                                            | Locally proven with mocked fetch responses.                     |
| 1.3 Pre-launch compatibility gate               | `src/main/hermes/gateway-process.ts`, `tests/gateway-restart.test.ts`.                                                                                        | Locally proven with mocked engine contract states.              |
| 1.4 Unified update state                        | `src/main/engine-update-state.ts`, `tests/engine-update-state.test.ts`.                                                                                       | Locally proven.                                                 |
| 1.5 Surface shipped upstream features           | Settings/provider/model capability changes, `tests/engine-capabilities.test.ts`, provider tests, renderer tests.                                              | Locally proven against mocked capabilities.                     |
| 1.6 Local UI capability gate                    | Chat/model picker capability changes and focused renderer tests.                                                                                              | Locally proven.                                                 |
| 2.1 SPS chat approvals                          | `src/renderer/src/screens/SpsAgent/store/slices/assistant.ts`, `AgentBody.tsx`, `tests/sps-work-approvals.test.ts`.                                           | Locally proven.                                                 |
| 2.2 Gateway keepalive while app closed          | Generated cron helper in `src/main/control-server.ts`, `tests/launchd-autonomy.test.ts`.                                                                      | Logic locally proven; real LaunchAgent check pending.           |
| 2.3 Owner-critical routines as engine cron jobs | `src/main/owner-routines.ts`, `tests/owner-routines.test.ts`.                                                                                                 | Locally proven with mocked cron creation.                       |
| 2.4 Routines status panel                       | `src/main/routines-status.ts`, `RoutinesStatusPanel.tsx`, routine status tests.                                                                               | Locally proven.                                                 |
| 2.5 Renderer intervals moved to scheduler       | `src/main/scheduler.ts`, `src/renderer/src/screens/SpsAgent/App.tsx`, `tests/scheduler.test.ts`.                                                              | Locally proven.                                                 |
| 3.1 Owner notification preferences              | `src/main/owner-delivery.ts`, `src/shared/owner-notifications.ts`, Settings IPC/preload, `tests/owner-delivery.test.ts`.                                      | Locally proven with mocked senders.                             |
| 3.2 Morning brief delivery                      | `src/main/daily-brief-delivery.ts`, `tests/daily-brief-delivery.test.ts`.                                                                                     | Locally proven with mocked delivery.                            |
| 3.3 Owner nag escalation                        | `src/main/nag-engine.ts`, `tests/nag-engine.test.ts`.                                                                                                         | Locally proven with mocked owner delivery.                      |
| 3.4 Telegram mobile client                      | `src/main/mobile-workspace-skill.ts`, `tests/mobile-workspace-skill.test.ts`.                                                                                 | Skill contract locally proven; live Telegram roundtrip pending. |
| 3.5 Email actions                               | `src/main/contact-messaging.ts`, `InboxSurface.tsx`, contact/inbox tests.                                                                                     | Locally proven with mailto and mocked task routing.             |
| 4.3 Operator widgets first                      | `OperatorWidgets.tsx`, `CockpitSurface.tsx`, cockpit tests, smoke screenshots.                                                                                | Locally proven.                                                 |
| 4.2 Sidebar reachability                        | `Sidebar.tsx`, `Sidebar.test.tsx`.                                                                                                                            | Locally proven.                                                 |
| 4.1 Home surface flip                           | `src/renderer/src/screens/SpsAgent/lib/theme.ts`, `tweaks.test.ts`.                                                                                           | Locally proven.                                                 |
| 4.4 CRM relationship engine V1                  | `src/main/contact-messaging.ts`, `TaskDrawer.tsx`, contact messaging tests, nag tests.                                                                        | Locally proven.                                                 |
| 5 Continuous deepening                          | Non-blocking backlog; direct tests added for high-blast-radius seams touched by this roadmap.                                                                 | Not a ship blocker.                                             |

## External Gates

### GitHub Actions

Completed. Manual dispatch run `28878242037` passed on fork branch
`codex/roadmap-phase0-note-index` at SHA `fd05e08aa7b66be1285d555553377c569b8172d0`. Manual dispatch
run `28878749010` then passed on the docs-refreshed branch head
`0d9a68249061f2f73d517fa062c45ae102e4d620`.

### LaunchAgent

Local tests execute the generated cron helper in a VM harness and prove:

- it restarts the gateway when desktop is closed and gateway health is down;
- it records `managed-by-desktop` instead of double-managing when the desktop control server is up;
- it preserves outage duration after recovery.

Additional proof completed: `scripts/launchagent-smoke.mjs` bootstrapped a unique disposable user
LaunchAgent label, observed execution through a marker file, booted it out, and removed its temporary
directory. It intentionally did not install or disturb the real `com.nousresearch.hermes-scheduler`
label.

Remaining caveat: the production Hermes scheduler label itself was not installed or accepted as a
persistent user agent in this audit.

### Owner Channels

Unit tests prove macOS/Telegram/email fanout, quiet hours, event opt-out, idempotency, and rate limiting with mocked senders.

Local redacted config check on `/Users/amar/.hermes` found `channel_directory.json` mentions
Telegram, but `ownerNotificationPrefsByProfile` has no configured owner Telegram/email targets.

Still required before owner use:

- configure a throwaway Telegram owner channel;
- send a Telegram message such as "add this as a task";
- verify the resulting SPS task is review-first, `source: telegram/mobile`, `route: human`, and not `context: include`;
- smoke real email/macOS notification delivery if those channels are enabled.
