# Hermes Desktop — Refactoring Audit

**Date:** 2026-07-18 · **Method:** read-only static analysis (~30 targeted grep/read sweeps across all layers), verifying currency of `IMPROVEMENT-REPORT-2026-07-03.md` findings. **Scope:** missing/incomplete features, dead code, bad smells, missed opportunities, process gaps.

## 0. Maturity verdict

This is a *disciplined* codebase (~180K lines `src/`, 926 source files), not a sloppy one. Zero TODO/FIXME markers (debt tracked in `docs/BACKLOG.md`); one `safeHandle()` IPC wrapper (357 call sites) with redacted logging; preload↔d.ts parity test-enforced; tiered network egress with SSRF pinning; CSP documented in `SECURITY-RESIDUALS.md`; CI runs typecheck+tests+lint+audit+SBOM+build+verify harnesses; `console.*` migration finished and lint-enforced. **The risk profile is unmanaged growth**: god files, a flat IPC/data layer, half-finished rollouts (i18n, validation), and release-process drift.

## 1. God files & missing decomposition (HIGH)

| File | Lines | Note |
|---|---|---|
| `src/renderer/src/screens/SpsAgent/inbox/InboxSurface.tsx` | 2110 | Largest file in app; pure helpers (schema/feedback/changeset mapping) separable at top of file |
| `src/renderer/src/screens/Settings/Settings.tsx` | 1666 | ~50 `useState`; decomposition plan existed since 07-03 (`superpowers/plans/2026-07-03-codebase-health.md` Task 1), never executed — file grew 1631→1666. **(Remediation started 2026-07-18.)** |
| `src/renderer/src/screens/Providers/Providers.tsx` | 1510 | Same section-router pattern applies |
| `SpsAgent/cockpit/CockpitSurface.tsx` | 1394 | |
| `SpsAgent/modals/ResearchModal.tsx` | 1258 | |
| `SpsAgent/health/PersonalHealthDashboard.tsx` | 1210 | |
| `SpsAgent/modals/ExternalSessionsModal.tsx` | 1180 | Has 2 of the 9 `exhaustive-deps` suppressions |
| `src/main/note-index.ts` | 1220 | FTS5+graph index; cannot run under vitest (ABI) → undertested by design |
| `src/main/control-server.ts` | 1190 | |
| `src/main/sps-agent.ts` | 1184 | |
| `src/main/hermes/chat-client/api.ts` | 1096 | Transport negotiation core — highest-blast-radius main file |
| `src/main/skills.ts`, `index.ts`, `hermes/gateway-process.ts`, `installer.ts` | 1005–1089 | |
| `src/main/ipc/health-rss.ts` (836), `ipc/notes.ts` (824), `ipc/config.ts` (714) | — | IPC *modules themselves* becoming god files |
| `src/preload/bridges/sps.ts` (1103) + `sps.types.ts` (928) | — | Bridge layer duplicating main-side surface area |

**Fix pattern (proven in repo):** section-router extraction for screens; pure-helper extraction first for surfaces; split IPC modules by domain noun.

## 2. Renderer has no data-access layer (HIGH)

- **699 direct `window.hermesAPI.*` call sites** in renderer components/stores; every component hand-rolls invoke + loading/error/cancellation. A thin data layer (per-domain hooks/services) would collapse hundreds of try/catch + `useEffect` fetch blocks and give one place for caching, retries, and connection-mode branching.
- Zustand discipline is otherwise good; SPS store is cleanly sliced (11 slices) — `slices/assistant.ts` (896) and `slices/workspace.ts` (828) are next up for splitting.

## 3. Incomplete rollouts & features (HIGH)

1. **i18n is vestigial:** `i18next` + `react-i18next` are dependencies, but only **9 of 257 renderer .tsx files** use them. **Decision (2026-07-18): keep the infrastructure, no big-bang either way.** Full removal churns working code (Settings alone has 75 `t()` calls, plus `src/shared/i18n`, `locale.ts`); a full rollout is weeks of low-value work for an English-first local app. Rule going forward: *new surfaces must use `t()`; existing surfaces migrate opportunistically when touched.*
2. **KB Phase 2 / RLM (BACKLOG item 1):** query-expansion shipped and measured (synonym-miss recall 0→80%); the decided next step — vault-as-navigable-toolset (`vault_search`/`vault_read_page`/`vault_follow_wikilink`) + routing KB questions through the agentic chat path — is **not built**. Residual hard-gap recall (20%) is the measured trigger for embeddings-as-a-tool.
3. **Remote/SSH grounding inconsistency (BACKLOG item 3):** chat path passes inline excerpts in remote mode, but `spsAssistant()` still gates grounding on `!isRemoteMode()` (`src/main/sps-agent.ts:451,467`). Two surfaces, two behaviors, decision deferred.
4. **IPC payload validation half-adopted:** `src/main/ipc/validate.ts` exists but is imported by only **6 of ~28** ipc modules. Path/profile-taking handlers elsewhere still cast `unknown` → type. **(Extension started 2026-07-18: `assertIpcNumber`/`assertIpcRecord`/`assertOptionalIpcRecord` added; `health-rss.ts` fully guarded — 7 scalar casts + 8 record payloads + media pre-validation before delete. Remaining: sweep for unguarded handlers in other modules.)**
5. **Unexecuted 07-03 codebase-health plan:** Settings decomposition (Task 1) and `exhaustive-deps` suppression audit (Task 5; **9 suppressions** unaudited). Tasks 2–4 were done but the plan file never said so — docs drift.
6. **Generate-from-repo large-repo heuristic** (BACKLOG item 5) and **per-button grounding / non-agent buttons** (item 6) — open.
7. **Headless features with zero UI surface:** `dream-cycle.ts` and `nag-engine.ts` are referenced only by `scheduler.ts` — no preload bridge, no renderer visibility, no user control. Intentional (document it) or missed affordance.

## 4. Dead code & dependency cruft (MEDIUM)

1. **Unused dependencies:** `react-file-icon` (only a CSS *comment*, `assets/main.css:3122`) and `vscode-material-icons` (0 references). **(Removed 2026-07-18.)**
2. **`scripts/` harness sprawl:** 38 top-level scripts; ~29 referenced from nowhere (not package.json, not CI, not other scripts) — one-off repro harnesses of unknown freshness. **(probe-*/drive-* consolidated under `scripts/repro/` 2026-07-18.)**
3. **Empty `archive/` dir** (0B). **(Removed 2026-07-18.)**
4. **`docs/feature-status/` is a binary `.xlsx`** — unreviewable in git; convert to markdown or drop.
5. **Duplicated helpers:** `localDateKey()` verbatim in 3 files (`config/desktop-store.ts:386`, `daily-brief.ts:7`, `hermes-upstream-watch.ts:172`) — emblematic of ~150 feature modules hand-rolling date/fs/JSON helpers. **(First dedupe landed 2026-07-18.)**
6. **Sibling parallel implementations** to consolidate or consciously keep: `daily-brief.ts` vs `owner-daily-brief.ts`; `email-triage.ts` vs `task-triage.ts`; local vs remote cron paths in `cronjobs.ts`.

## 5. Release / process drift (MEDIUM)

1. **Version confusion:** `package.json` = 0.5.4, `changelogs/` stops at 0.5.0, yet git tags up to **v0.7.0** exist. **Investigated 2026-07-18:** the v0.6.x–v0.7.0 tags are `release`-branch lineage ("Merge branch 'main' into release" → "Release v0.7.0"); v0.7.0 **is** an ancestor of `upstream/main` (fathah/hermes-desktop) but **not** of local `main`, which sits 580 commits past v0.5.4 without the release merges. So the release flow is healthy on the remote; *local* `main` has simply diverged from it. **Owner action required:** reconcile local `main` with `upstream/main` (merge or rebase) — do NOT hand-bump `package.json`; let the release flow own versions. Changelogs for 0.5.1+ presumably exist on `upstream/main` and will arrive with the reconcile.
2. **Husky hooks called `bun run` in an npm project** (`.husky/pre-commit`, `pre-push`). **(Fixed 2026-07-18.)** Release-only gating is intentional per CLAUDE.md.
3. **Stray root-level `sps-agent/node_modules` (200M, untracked)** — botched past install; delete after confirming nothing references it.
4. **No changelog automation** tying `package.json` version → `changelogs/<v>.md`.

## 6. Security & robustness residuals (LOW–MEDIUM, mostly managed)

- `shell.openExternal` is allowlisted — good. `dangerouslySetInnerHTML` has 9 sites; `DiffBlock` sanitizes, but `MermaidBlock.tsx:107`, `ExcalidrawBlock.tsx:107`, `Icon.tsx:46`, `WorktreePanel.tsx:33` inject generated SVG unsanitized — low risk, worth one uniform sanitize pass.
- **`mcp_servers:` block still parsed by line-regex over raw text** (`src/main/mcp-servers.ts:206-382`) — "most fragile coupling in the repo" per the 07-03 report; move to the `yaml` lib used elsewhere.
- Capability negotiation (`resolveHermesChatTransport`, `chat-client/api.ts`) covers chat in remote/SSH mode only; local mode + non-chat endpoints hard-coded.
- No engine version pin anywhere; installs track upstream `main` HEAD (flagship track: `superpowers/plans/2026-07-03-upstream-capture-and-exposure.md`).

## 7. Test & quality-gate gaps (LOW–MEDIUM)

- Renderer: 119 colocated test files vs 445 source files; big screens (Settings, Providers, InboxSurface) have no component tests — highest regression risk, lowest coverage. `chat-client/api.ts` negotiation has only deadline/streaming tests.
- 3 conditional `describe.skip` (vault-semantic-search, newsroom-curator) can silently never run in CI — add a skip-report check.
- `verify:note-index`/`verify:external-context`/smoke/firstrun-seed are CI-wired (good); `verify:engine-contract` is not in `ci.yml`.

## 8. What is NOT a problem (don't "fix" these)

Zero-TODO discipline, safeHandle uniformity, preload parity test, redacted logging, SSRF/CSP posture, console.* lint enforcement, storage-invariant test rigor (golden serializer tests), CI breadth, dependency currency (Electron 39/React 19), docs culture (BACKLOG/SECURITY-RESIDUALS genuinely maintained).

---

## Remediation log

- **2026-07-18** — Quick wins landed: unused deps removed, husky `bun`→`npm`, empty `archive/` + stray `sps-agent/node_modules` deleted, probe/drive scripts consolidated to `scripts/repro/`, `localDateKey` deduped into `src/main/utils.ts`, feature-status xlsx → `docs/feature-status/hermes-feature-status.md`. Deep remediation: Settings.tsx decomposed into section router + 4 section components (Task 1 of `2026-07-03-codebase-health.md`); `assertIpcNumber` added and `health-rss.ts` scalar casts guarded; InboxSurface slice 1 — pure helpers extracted to `inbox/inboxModel.ts` (2110→~1965 ln, 14 new tests) and byte-identical duplicates removed from `QuickCapture.tsx`. Committed as 6 scoped commits on `main` (`22ebb670`..`b2505299`).
