# Hermes Desktop Roadmap Completion Audit - 2026-07-07

Branch: `codex/roadmap-phase0-note-index`

Implementation scope audited: original roadmap implementation at
`0d9a68249061f2f73d517fa062c45ae102e4d620`, plus continuation commits on this
branch for the disposable LaunchAgent smoke, guarded mobile task intake, and
real-control-server mobile task smoke, macOS owner-delivery smoke, and owner-routines cron smoke.

Source plan: `ROADMAP.md`

## Summary

The roadmap implementation is committed and pushed to `origin/codex/roadmap-phase0-note-index`.
Local verification passed across lint, typecheck, Vitest, Electron-ABI note-index verification,
external-context verification, production build, and the SPS Playwright-Electron smoke. GitHub
Actions also passed on the fork branch after two CI-only test hermeticity fixes.
The remaining launchd lifecycle risk was reduced with a disposable LaunchAgent smoke that bootstraps,
runs, boots out, and cleans up a unique temporary user-agent label.
The production Hermes scheduler LaunchAgent is also currently accepted by launchd under `gui/501`:
`launchctl print gui/501/com.nousresearch.hermes-scheduler` reports the expected plist path,
`StartInterval`/run interval of 60 seconds, 93 runs, and last exit code 0.
An isolated owner-routines cron smoke now runs the real `ensureOwnerCriticalCronJobs()` →
`createCronJob()` desktop path against a temp Hermes CLI shim, then verifies the morning brief and
overnight triage jobs are created with the expected schedules, local delivery target, and paused
first-run-manual state.
The Telegram mobile-client write boundary now has a guarded local intake path: authenticated control
clients can call `/sps/mobile-task` or the generated `sps task` helper to create review-first human
task rows with `source: telegram/mobile` and without `context: include`.
A redacted owner-channel readiness check now makes the remaining Telegram gate reproducible without
sending live messages; on the current `/Users/amar/.hermes` it exits blocked because owner
notification prefs are not saved for the active profile and the channel directory has zero Telegram
targets.
An explicit-gated outbound Telegram live-smoke harness now reuses that readiness gate and only sends
after both `--send` and `HERMES_OWNER_CHANNEL_LIVE=1` are present.
An explicit-gated inbound mobile-task live-smoke harness now checks the authenticated local control
server, posts through `/sps/mobile-task` only after `--write` and `HERMES_MOBILE_TASK_LIVE=1`, and
verifies the persisted vault row stays review-first. On the current machine it fails closed because
the saved control-server port is not reachable from this worktree session.
An isolated Electron control-server smoke now launches the built app with throwaway `HOME` and
`HERMES_HOME`, discovers the real control-server token/port, writes one `/sps/mobile-task` row, and
verifies the persisted vault markdown. That proves the local runtime path without touching the
production Hermes home or production LaunchAgent plist.
An explicit-gated macOS owner-delivery smoke now launches Electron with throwaway `HOME` and
`HERMES_HOME`, enables only the macOS owner channel for a temp profile, and proves the real
owner-delivery module reports `status: sent` without touching the production Hermes home.

The implementation should not be called fully owner-shipped until the remaining external/manual gates
below are proven:

- Live owner-channel delivery is smoked with a real configured Telegram owner channel.
- A real Telegram mobile "add this as a task" roundtrip writes the review-first SPS task row through
  the guarded local intake path.

## Local Evidence

Commands run after the implementation and CI-hardening patches:

| Command                                                                                                                                                                                                                                     | Result                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx vitest run tests/mobile-workspace-skill.test.ts`                                                                                                                                                                                       | Passed: 1 file, 3 tests.                                                                                                                                     |
| `npx eslint src/main/mobile-workspace-skill.ts tests/mobile-workspace-skill.test.ts`                                                                                                                                                        | Passed.                                                                                                                                                      |
| `TMPDIR=/private/tmp npx vitest run tests/newsroom-curator.test.ts tests/vault-semantic-search.test.ts`                                                                                                                                     | Passed: 2 files, 7 tests.                                                                                                                                    |
| `TMPDIR=/private/tmp HERMES_NEWSROOM_CURATOR_SCRIPT=/private/tmp/missing-cluster.py HERMES_VAULT_SEMANTIC_SEARCH_SCRIPT=/private/tmp/missing-semantic.py npx vitest run tests/newsroom-curator.test.ts tests/vault-semantic-search.test.ts` | Passed: 2 files skipped, 7 tests skipped.                                                                                                                    |
| `TMPDIR=/private/tmp npx vitest run tests/app-launcher.test.ts`                                                                                                                                                                             | Passed: 1 file, 8 tests.                                                                                                                                     |
| `npx eslint tests/newsroom-curator.test.ts tests/vault-semantic-search.test.ts`                                                                                                                                                             | Passed.                                                                                                                                                      |
| `npx eslint tests/app-launcher.test.ts`                                                                                                                                                                                                     | Passed.                                                                                                                                                      |
| `node --check scripts/launchagent-smoke.mjs`                                                                                                                                                                                                | Passed.                                                                                                                                                      |
| `npx eslint scripts/launchagent-smoke.mjs`                                                                                                                                                                                                  | Passed.                                                                                                                                                      |
| `node scripts/launchagent-smoke.mjs`                                                                                                                                                                                                        | Passed: bootstrapped disposable label `com.nousresearch.hermes-scheduler.codex-smoke.33903` in `gui/501`, wrote marker, booted out, and cleaned up.          |
| `test ! -e /private/tmp/hermes-launchagent-smoke-Eis4HE`                                                                                                                                                                                    | Passed: smoke temp directory was removed.                                                                                                                    |
| `launchctl print gui/$(id -u)/com.nousresearch.hermes-scheduler`                                                                                                                                                                            | Passed: production label loaded from `~/Library/LaunchAgents/com.nousresearch.hermes-scheduler.plist`; 93 runs; last exit code 0.                            |
| `plutil -p ~/Library/LaunchAgents/com.nousresearch.hermes-scheduler.plist`                                                                                                                                                                  | Passed: plist points to `/Users/amar/.hermes/bin/hermes-cron.js` with `RunAtLoad: true` and `StartInterval: 60`.                                             |
| `node --check scripts/owner-routines-cron-smoke.mjs`                                                                                                                                                                                        | Passed.                                                                                                                                                      |
| `node scripts/owner-routines-cron-smoke.mjs`                                                                                                                                                                                                | Passed: isolated temp Hermes CLI shim created `owner-routine:morning-brief` at `0 7 * * *` and `owner-routine:overnight-triage` at `0 2 * * *`; both paused. |
| `TMPDIR=/private/tmp npx vitest run tests/owner-routines.test.ts tests/cronjobs.test.ts tests/cron-quality.test.ts`                                                                                                                         | Passed: 3 files, 13 tests.                                                                                                                                   |
| `npx eslint scripts/owner-routines-cron-smoke.mjs`                                                                                                                                                                                          | Passed.                                                                                                                                                      |
| `node --check scripts/owner-channel-readiness.mjs`                                                                                                                                                                                          | Passed.                                                                                                                                                      |
| `node scripts/owner-channel-readiness.mjs`                                                                                                                                                                                                  | Passed: read-only redacted check returned `status: blocked`, profile `default`, no owner prefs entry, `telegramLiveReady: false`, and zero Telegram targets. |
| `node scripts/owner-channel-readiness.mjs --require-ready`                                                                                                                                                                                  | Expected exit 2: same redacted blocked state, proving the gate fails closed until owner channels are configured.                                             |
| `node scripts/owner-channel-readiness.mjs --require-ready --require-telegram`                                                                                                                                                               | Expected exit 2: failed closed until Telegram owner prefs and a gateway Telegram target are both configured.                                                 |
| `TMPDIR=/private/tmp npx vitest run tests/owner-channel-readiness-script.test.ts`                                                                                                                                                           | Passed: 1 file, 5 tests.                                                                                                                                     |
| `npx eslint scripts/owner-channel-readiness.mjs tests/owner-channel-readiness-script.test.ts`                                                                                                                                               | Passed.                                                                                                                                                      |
| `node --check scripts/owner-channel-live-smoke.mjs`                                                                                                                                                                                         | Passed.                                                                                                                                                      |
| `node scripts/owner-channel-live-smoke.mjs`                                                                                                                                                                                                 | Expected exit 2: failed closed with `reason: telegram-not-ready` against current `/Users/amar/.hermes`.                                                      |
| `TMPDIR=/private/tmp npx vitest run tests/owner-channel-live-smoke-script.test.ts tests/owner-channel-readiness-script.test.ts`                                                                                                             | Passed: 2 files, 7 tests.                                                                                                                                    |
| `npx eslint scripts/owner-channel-live-smoke.mjs tests/owner-channel-live-smoke-script.test.ts`                                                                                                                                             | Passed.                                                                                                                                                      |
| `node --check scripts/owner-macos-delivery-smoke.mjs`                                                                                                                                                                                       | Passed.                                                                                                                                                      |
| `node scripts/owner-macos-delivery-smoke.mjs`                                                                                                                                                                                               | Passed: dry-run reported `requiredForSend: ["--send","HERMES_OWNER_MACOS_LIVE=1"]`.                                                                          |
| `HERMES_OWNER_MACOS_LIVE=1 node scripts/owner-macos-delivery-smoke.mjs --send`                                                                                                                                                              | Passed: isolated Electron runner returned `status: sent`, `ok: true`, macOS channel `status: sent`, and owner delivery summary `Sent via macOS.`             |
| `npx eslint scripts/owner-macos-delivery-smoke.mjs`                                                                                                                                                                                         | Passed.                                                                                                                                                      |
| `node --check scripts/mobile-task-live-smoke.mjs`                                                                                                                                                                                           | Passed.                                                                                                                                                      |
| `node scripts/mobile-task-live-smoke.mjs`                                                                                                                                                                                                   | Expected exit 2: failed closed with `reason: control-server-unavailable`, profile `default`, and saved control port `8645`.                                  |
| `TMPDIR=/private/tmp npx vitest run tests/mobile-task-live-smoke-script.test.ts tests/mobile-workspace-intake.test.ts tests/control-server.test.ts`                                                                                         | Passed: 3 files, 16 tests.                                                                                                                                   |
| `npx eslint scripts/mobile-task-live-smoke.mjs tests/mobile-task-live-smoke-script.test.ts`                                                                                                                                                 | Passed.                                                                                                                                                      |
| `node --check scripts/mobile-task-control-server-smoke.mjs`                                                                                                                                                                                 | Passed.                                                                                                                                                      |
| `node scripts/mobile-task-control-server-smoke.mjs`                                                                                                                                                                                         | Passed: launched isolated Electron app, discovered control port `8645`, wrote row `mobile-task-mrawy8ki-028bb4`, and verified review-first task metadata.    |
| `npx eslint scripts/mobile-task-control-server-smoke.mjs scripts/mobile-task-live-smoke.mjs`                                                                                                                                                | Passed.                                                                                                                                                      |
| `TMPDIR=/private/tmp npx vitest run tests/vault-semantic-search.test.ts tests/mobile-task-live-smoke-script.test.ts tests/mobile-workspace-intake.test.ts tests/control-server.test.ts`                                                     | Passed: 4 files, 19 tests.                                                                                                                                   |
| `npx eslint tests/vault-semantic-search.test.ts scripts/mobile-task-control-server-smoke.mjs scripts/mobile-task-live-smoke.mjs`                                                                                                            | Passed.                                                                                                                                                      |
| `TMPDIR=/private/tmp npx vitest run tests/mobile-workspace-intake.test.ts tests/mobile-workspace-skill.test.ts tests/control-server.test.ts`                                                                                                | Passed: 3 files, 15 tests.                                                                                                                                   |
| `npx eslint src/main/mobile-workspace-intake.ts src/main/control-server.ts src/main/mobile-workspace-skill.ts tests/mobile-workspace-intake.test.ts tests/control-server.test.ts tests/mobile-workspace-skill.test.ts`                      | Passed.                                                                                                                                                      |
| `npm run lint`                                                                                                                                                                                                                              | Passed.                                                                                                                                                      |
| `npm run typecheck`                                                                                                                                                                                                                         | Passed: node and web TypeScript projects.                                                                                                                    |
| `TMPDIR=/private/tmp npm test`                                                                                                                                                                                                              | Passed: 376 files, 2840 tests passed, 3 skipped.                                                                                                             |
| `npm run verify:note-index`                                                                                                                                                                                                                 | Passed: all note-index checks, including corrupt-cache self-heal.                                                                                            |
| `npm run verify:external-context`                                                                                                                                                                                                           | Passed: all external-context checks, including redaction and MCP roundtrip.                                                                                  |
| `npm run build`                                                                                                                                                                                                                             | Passed with existing Vite dynamic-import warnings.                                                                                                           |
| `SMOKE_OUT=/private/tmp/hermes-sps-smoke node scripts/sps-smoke.mjs`                                                                                                                                                                        | Passed: 29 screenshots, `SMOKE_DONE`.                                                                                                                        |
| `git diff --check`                                                                                                                                                                                                                          | Passed.                                                                                                                                                      |

One validation artifact to avoid: running `npm run lint` in parallel with `npm run verify:note-index`
can race the verifier's transient `.verify-ni.cjs` file. Serial lint passed.

One local full-suite rerun timed out in `tests/capability-risk.test.ts` while full lint and Vitest
were running concurrently. The focused test passed on rerun, and the serial full `npm test` passed.

One later full-suite rerun entered the opportunistic live Ollama branch in
`tests/vault-semantic-search.test.ts` because local `/api/tags` responded, but model verification
calls timed out. That live integration is now opt-in with `HERMES_ENABLE_LIVE_OLLAMA_TEST=1`, keeping
the default suite hermetic while preserving the explicit live check.

## GitHub Actions Evidence

Latest fork CI run for the code head before this real-control-server smoke refresh:

- Run: `28884560211`
- URL: `https://github.com/saxster/hermes-desktop/actions/runs/28884560211`
- Event: `workflow_dispatch`
- Branch: `codex/roadmap-phase0-note-index`
- SHA: `3e86f4a0c95f05e5e935456f0b572cbf784dbfed`
- Result: passed
- `check`: passed in 3m41s, including dependency install, audit, SBOM upload, typecheck, test, and lint.
- `verify-smoke`: passed in 2m32s, including build, note-index verification, external-context
  verification, and SPS smoke.

Earlier fork CI run for the code head before the mobile task live-smoke refresh:

- Run: `28881233027`
- URL: `https://github.com/saxster/hermes-desktop/actions/runs/28881233027`
- Event: `workflow_dispatch`
- Branch: `codex/roadmap-phase0-note-index`
- SHA: `41dd70e81610de8725a7188db65300c26060f838`
- Result: passed
- `check`: passed in 4m31s, including dependency install, audit, SBOM upload, typecheck, test, and lint.
- `verify-smoke`: passed in 2m18s, including build, note-index verification, external-context
  verification, and SPS smoke.

Earlier fork CI run before the LaunchAgent smoke harness was added:

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

| Roadmap item                                    | Evidence                                                                                                                                                                                                                                                                                                                                                         | Status                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1 Note-index self-healing                     | `src/main/note-index.ts`, `scripts/verify-note-index.ts`, `npm run verify:note-index`.                                                                                                                                                                                                                                                                           | Locally proven.                                                                                                                                         |
| 0.2 Atomic writes everywhere                    | `src/main/utils.ts`, migrated persistence callers, `tests/safe-write-file-fsync.test.ts`, `tests/self-healing.test.ts`.                                                                                                                                                                                                                                          | Locally proven.                                                                                                                                         |
| 0.3 SSH tunnel watchdog                         | `src/main/ssh-tunnel.ts`, `tests/ssh-tunnel.test.ts`, gateway restart coverage.                                                                                                                                                                                                                                                                                  | Locally proven.                                                                                                                                         |
| 0.4 Gateway hang and port conflict visibility   | `src/main/hermes/gateway-process.ts`, `src/main/gateway-ports.ts`, gateway tests.                                                                                                                                                                                                                                                                                | Locally proven.                                                                                                                                         |
| 0.5 Aborted stream terminal callback            | `src/main/hermes/chat-client/api.ts`, `tests/chat-client-streaming.test.ts`.                                                                                                                                                                                                                                                                                     | Locally proven.                                                                                                                                         |
| 0.6 Scheduled research `lastError`              | `src/main/scheduled-research.ts`, `tests/scheduled-research.test.ts`.                                                                                                                                                                                                                                                                                            | Locally proven.                                                                                                                                         |
| 0.7 CI all tiers                                | `.github/workflows/ci.yml` includes `verify-smoke`; workflow dispatch run `28878749010` passed on fork branch SHA `0d9a68249061f2f73d517fa062c45ae102e4d620`.                                                                                                                                                                                                    | Proven on GitHub Actions.                                                                                                                               |
| 1.0 Plan checkbox reconciliation                | Updated superpowers plan docs.                                                                                                                                                                                                                                                                                                                                   | Locally proven by path review.                                                                                                                          |
| 1.1 Release-channel updates                     | `src/main/hermes-agent-updates.ts`, `tests/hermes-agent-update-check.test.ts`, update routine tests.                                                                                                                                                                                                                                                             | Locally proven with mocked GitHub release data.                                                                                                         |
| 1.2 Live install-script refresh                 | `src/main/installer.ts`, `tests/installer-script-refresh.test.ts`.                                                                                                                                                                                                                                                                                               | Locally proven with mocked fetch responses.                                                                                                             |
| 1.3 Pre-launch compatibility gate               | `src/main/hermes/gateway-process.ts`, `tests/gateway-restart.test.ts`.                                                                                                                                                                                                                                                                                           | Locally proven with mocked engine contract states.                                                                                                      |
| 1.4 Unified update state                        | `src/main/engine-update-state.ts`, `tests/engine-update-state.test.ts`.                                                                                                                                                                                                                                                                                          | Locally proven.                                                                                                                                         |
| 1.5 Surface shipped upstream features           | Settings/provider/model capability changes, `tests/engine-capabilities.test.ts`, provider tests, renderer tests.                                                                                                                                                                                                                                                 | Locally proven against mocked capabilities.                                                                                                             |
| 1.6 Local UI capability gate                    | Chat/model picker capability changes and focused renderer tests.                                                                                                                                                                                                                                                                                                 | Locally proven.                                                                                                                                         |
| 2.1 SPS chat approvals                          | `src/renderer/src/screens/SpsAgent/store/slices/assistant.ts`, `AgentBody.tsx`, `tests/sps-work-approvals.test.ts`.                                                                                                                                                                                                                                              | Locally proven.                                                                                                                                         |
| 2.2 Gateway keepalive while app closed          | Generated cron helper in `src/main/control-server.ts`, `tests/launchd-autonomy.test.ts`, `scripts/launchagent-smoke.mjs`, `launchctl print gui/501/com.nousresearch.hermes-scheduler`.                                                                                                                                                                           | Logic locally proven; production LaunchAgent accepted by launchd.                                                                                       |
| 2.3 Owner-critical routines as engine cron jobs | `src/main/owner-routines.ts`, `scripts/owner-routines-cron-smoke.mjs`, `tests/owner-routines.test.ts`.                                                                                                                                                                                                                                                           | Locally proven with mocked cron creation and an isolated desktop-to-Hermes-CLI cron smoke.                                                              |
| 2.4 Routines status panel                       | `src/main/routines-status.ts`, `RoutinesStatusPanel.tsx`, routine status tests.                                                                                                                                                                                                                                                                                  | Locally proven.                                                                                                                                         |
| 2.5 Renderer intervals moved to scheduler       | `src/main/scheduler.ts`, `src/renderer/src/screens/SpsAgent/App.tsx`, `tests/scheduler.test.ts`.                                                                                                                                                                                                                                                                 | Locally proven.                                                                                                                                         |
| 3.1 Owner notification preferences              | `src/main/owner-delivery.ts`, `src/shared/owner-notifications.ts`, Settings IPC/preload, `scripts/owner-macos-delivery-smoke.mjs`, `tests/owner-delivery.test.ts`.                                                                                                                                                                                               | Locally proven with mocked senders; macOS owner-delivery proven through isolated Electron smoke.                                                        |
| 3.2 Morning brief delivery                      | `src/main/daily-brief-delivery.ts`, `tests/daily-brief-delivery.test.ts`.                                                                                                                                                                                                                                                                                        | Locally proven with mocked delivery.                                                                                                                    |
| 3.3 Owner nag escalation                        | `src/main/nag-engine.ts`, `tests/nag-engine.test.ts`.                                                                                                                                                                                                                                                                                                            | Locally proven with mocked owner delivery.                                                                                                              |
| 3.4 Telegram mobile client                      | `src/main/mobile-workspace-skill.ts`, `src/main/mobile-workspace-intake.ts`, `src/main/control-server.ts`, `scripts/mobile-task-live-smoke.mjs`, `scripts/mobile-task-control-server-smoke.mjs`, `tests/mobile-workspace-skill.test.ts`, `tests/mobile-workspace-intake.test.ts`, `tests/control-server.test.ts`, `tests/mobile-task-live-smoke-script.test.ts`. | Guarded local mobile task capture, explicit live-smoke harness, and isolated real-control-server runtime smoke proven; real Telegram roundtrip pending. |
| 3.5 Email actions                               | `src/main/contact-messaging.ts`, `InboxSurface.tsx`, contact/inbox tests.                                                                                                                                                                                                                                                                                        | Locally proven with mailto and mocked task routing.                                                                                                     |
| 4.3 Operator widgets first                      | `OperatorWidgets.tsx`, `CockpitSurface.tsx`, cockpit tests, smoke screenshots.                                                                                                                                                                                                                                                                                   | Locally proven.                                                                                                                                         |
| 4.2 Sidebar reachability                        | `Sidebar.tsx`, `Sidebar.test.tsx`.                                                                                                                                                                                                                                                                                                                               | Locally proven.                                                                                                                                         |
| 4.1 Home surface flip                           | `src/renderer/src/screens/SpsAgent/lib/theme.ts`, `tweaks.test.ts`.                                                                                                                                                                                                                                                                                              | Locally proven.                                                                                                                                         |
| 4.4 CRM relationship engine V1                  | `src/main/contact-messaging.ts`, `TaskDrawer.tsx`, contact messaging tests, nag tests.                                                                                                                                                                                                                                                                           | Locally proven.                                                                                                                                         |
| 5 Continuous deepening                          | Non-blocking backlog; direct tests added for high-blast-radius seams touched by this roadmap.                                                                                                                                                                                                                                                                    | Not a ship blocker.                                                                                                                                     |

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

Production proof completed: `launchctl print gui/501/com.nousresearch.hermes-scheduler` shows the
real scheduler label loaded from `~/Library/LaunchAgents/com.nousresearch.hermes-scheduler.plist`,
pointing at `/Users/amar/.hermes/bin/hermes-cron.js`, with a 60-second run interval, 93 runs, and
last exit code 0.

Additional owner-routine proof completed: `scripts/owner-routines-cron-smoke.mjs` uses a throwaway
`HERMES_HOME` plus temp Hermes CLI shim to exercise the real `owner-routines` and `cronjobs` modules.
It creates `owner-routine:morning-brief` and `owner-routine:overnight-triage`, parses the CLI
`Created job:` success signature, pauses both jobs for manual first run, and verifies local delivery
and stable dated prompt contracts. This proves the desktop-to-engine cron contract without touching
production cron state; it is not a live upstream Hermes Agent execution of the routines.

### Owner Channels

Unit tests prove macOS/Telegram/email fanout, quiet hours, event opt-out, idempotency, and rate limiting with mocked senders.
Additional local tests prove that a mobile "add this as a task" request can only enter the workspace
through a guarded task row path (`/sps/mobile-task` or `sps task`). The guarded row writes:

- `source: telegram/mobile`;
- `route: human`;
- `status: inbox`;
- `reviewRequired: true`;
- no `context: include`.

Local redacted config check on `/Users/amar/.hermes`, now reproducible with
`node scripts/owner-channel-readiness.mjs`, found no configured `ownerNotificationPrefsByProfile`
entry for the active profile and zero Telegram targets in `channel_directory.json`. Running the same
script with `--require-ready` exits 2 while blocked.
The outbound live-smoke handoff is now reproducible with `scripts/owner-channel-live-smoke.mjs`; it
fails closed while Telegram readiness is blocked, dry-runs when ready, and only sends after both
`--send` and `HERMES_OWNER_CHANNEL_LIVE=1` are present. The read-only readiness command also supports
`--require-telegram`, which exits 2 unless Telegram has both owner prefs and a gateway Telegram
target; this avoids treating macOS-only readiness as proof of the Telegram owner-channel gate.
The inbound mobile-task live-smoke handoff is now reproducible with
`scripts/mobile-task-live-smoke.mjs`; it verifies the local control server state, dry-runs without
writing by default, only posts after both `--write` and `HERMES_MOBILE_TASK_LIVE=1` are present, and
then verifies the persisted task markdown is `status: inbox`, `route: human`,
`source: telegram/mobile`, `captureChannel: telegram`, `reviewRequired: true`, and has no `context`.
On the current machine it exits 2 before writing because the saved control-server port `8645` is not
reachable from this worktree session.
`scripts/mobile-task-control-server-smoke.mjs` then proves the same write path against a real
Electron-started control server in an isolated temp home: it writes one `telegram/mobile` task row
through `/sps/mobile-task` and verifies the persisted markdown is review-first. This closes the local
runtime control-server proof while leaving the owner-profile Telegram roundtrip unproven.
`scripts/owner-macos-delivery-smoke.mjs` proves the real macOS owner-delivery path in an isolated
Electron runtime: it writes temp owner prefs, calls `deliverOwnerNotification`, and verifies the
result summary reports `Sent via macOS.` This closes the local macOS notification smoke without
touching production owner prefs.

Still required before owner use:

- configure a throwaway Telegram owner channel;
- rerun `node scripts/owner-channel-readiness.mjs --require-ready --require-telegram` and confirm it
  exits 0 with `telegramLiveReady: true`;
- run `HERMES_OWNER_CHANNEL_LIVE=1 node scripts/owner-channel-live-smoke.mjs --send` and confirm the
  smoke message reaches the configured owner Telegram channel;
- run `HERMES_MOBILE_TASK_LIVE=1 node scripts/mobile-task-live-smoke.mjs --write` against the real
  owner-profile control server and confirm it writes exactly one review-first SPS task row;
- send a Telegram message such as "add this as a task" through the gateway bot and have it call the guarded mobile task path;
- verify the live-written SPS task is review-first, `source: telegram/mobile`, `route: human`, and not `context: include`;
- smoke real email delivery if that channel is enabled.
