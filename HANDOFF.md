# HANDOFF — branch `harness/thin-slice` (2026-07-25)

Phase 1 of turning Hermes Desktop into a **harness over the Hermes engine**.
Full plan: `~/.claude/plans/how-can-we-hugely-jolly-elephant.md`

## Why this branch exists

The owner's goal: a Notion-style workspace with a resident agent (email, research,
news briefings, cron) where **Hermes Agent is the engine and this app is the harness**.

That architecture was already the stated intent and the code did not implement it,
because of one closed door: **the engine could not write into the vault.**

- `src/main/control-server.ts` has had the endpoints all along —
  `POST /sps/page` (:430), `POST /sps/capture` (:390), `POST /sps/task` (:455)
- `src/mcp/desktop-server.ts` exposed only `create_cron_job` and `build_context_pack`
- `~/.hermes/config.yaml` had `mcp_servers.desktop.enabled: false`

So every feature that wanted to produce a page built its own producer in TypeScript —
an IMAP client in Electron main, an RSS fetcher, a research synthesizer, three parallel
copies of the same cron-brief machine. None ever ran. Meanwhile `owner-daily-brief.ts`,
the one feature built correctly, has produced a good brief at 07:00 every day for weeks
into `~/.hermes/cron/output/70a4fd959098/` — and nothing drained it.

## State: 9 commits, tree clean, 0 behind `origin/main` (clean fast-forward), NOT merged

| Commit     | Work                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| `85642929` | W0.1 refuse to install the machine-global LaunchAgent for an ephemeral `HERMES_HOME` |
| `0b242309` | W0.3 note-index WAL checkpoint (timer + on close)                                    |
| `92a2ad3a` | W0.4 stop double-wrapping frontmatter in daily briefs                                |
| `852271aa` | W0.2 defer cron dispatch to the engine ticker when it is alive                       |
| `3c78acf2` | **W1 the MCP door** — `sps_write_page` / `sps_write_capture` / `sps_create_task`     |
| `efb5df61` | W2 engine writes its brief as a page + prompt-comparison fix                         |
| `691d4661` | rebuilt `resources/desktop-mcp.cjs` (tracked; config points at it)                   |

**Gate green** (re-verified 2026-07-25 22:15, 0 behind `origin/main`): 2 typecheck
projects ✅ → eslint on the 13 touched files ✅ → **3147 vitest pass** (421 files) ✅ →
`verify:note-index` ✅ → `npm run build` ✅. Every fix has a regression test proven to
fail without it.

Two gate caveats that are NOT this branch's doing:

- **Repo-wide `npm run lint` is red on `origin/main`.** One prettier warning at
  `src/renderer/src/screens/SpsAgent/inbox/InboxSurface.test.tsx:703` plus
  `--max-warnings=0`. That file is byte-identical to `origin/main` and untouched here.
  Fix it as a separate one-line commit; don't bundle it (CONTRIBUTING: single-purpose).
- **`verify:note-index` needs a writable `TMPDIR`.** It `mkdtemp`s in the system temp
  dir and dies with `EPERM` in a sandboxed shell. Run
  `TMPDIR=<scratchpad> npm run verify:note-index`. Same root cause as the known vitest
  `TMPDIR` gotcha.

## THE PROOF — LANDED 2026-07-25 21:40 ✅

The architecture is proven end to end. Rather than wait for the 07:00 schedule, the job
was triggered on demand (`hermes cron run 472aa86544a3`) — same code path, deterministic:

```
engine cron run → MCP sps_write_page → POST /sps/page → vault markdown → note index → ⌘K
```

Artifact: `~/.hermes/sps-agent/vault/daily-brief-2026-07-25.md` — engine-written, **single**
frontmatter block (W0.4 holding), and `GET /sps/search?q=…` returns it by content.

### Three corrections to this document's original next-step instructions

1. **The cron prompt was the only real gap.** Running this build once rewrote it via
   `syncOwnerDailyBriefCron` (`src/main/index.ts:991`, which runs unconditionally at
   startup). The sync **recreated the job under a new id: `70a4fd959098` →
   `472aa86544a3`**, so the output directory moved to
   `~/.hermes/cron/output/472aa86544a3/`. Any doc citing the old id is stale.
2. **`npm run dev` does NOT restart a running gateway.** `startGatewayDetailed` returns
   `alreadyRunning: true` and adopts it (`src/main/hermes/gateway-process.ts:272-274`).
3. **No gateway restart is needed anyway.** `discover_mcp_tools()` runs once per agent
   worker session (`tools/mcp_tool.py:3503`), and its `_load_mcp_config()` →
   `load_config()` is cached on the config file's `(mtime_ns, size)`
   (`hermes_cli/config.py:7308`) — so a changed `config.yaml` is picked up on the next
   session. **Zero `desktop-mcp.cjs` processes while idle is the normal steady state,
   not evidence of a closed door.** Do not chase it as a bug.

### KNOWN CONSTRAINT — the write path requires the desktop app to be running

`sps_write_page` POSTs to the control server on `127.0.0.1:8645`, which is served by the
Electron app itself (`startControlServer`). There is **no headless control server** —
`hermes-cron.cjs` only _probes_ that port to detect app liveness
(`src/main/headless/cron-runner.ts:235`).

Consequence: with the app closed, a scheduled run still produces its brief into
`~/.hermes/cron/output/472aa86544a3/`, but **writes no page**. This is in tension with the
W0.1 closed-app autonomy work and needs an explicit decision — either accept "the app is
resident and open", or add a headless control server. Not yet decided.

## Machine state changed outside the repo

- `~/Library/LaunchAgents/com.nousresearch.hermes-scheduler.plist` — repaired to point
  at `~/.hermes` and reloaded. **Verified live:** `launchctl` status 0, ticks every 60s,
  zero errors, correct `desktop-alive.skip` while the app is open.
- `~/.hermes/config.yaml` — `mcp_servers.desktop` now `enabled: true`,
  `command: /opt/homebrew/bin/node`, args → this worktree's `resources/desktop-mcp.cjs`.
  **This is a dev path in a live config** — repoint it at the installed app's bundle
  once a real build ships, or MCP breaks if this worktree is removed.
- Deleted stale `~/.hermes/bin/hermes-cron.js` (13 Jul).

## ❌ RETRACTED — the 2026-07-26 07:00 run did NOT write to the vault

**This section previously claimed an unattended 07:00 proof. The logs say otherwise.**
Checked 2026-07-26 16:00 against `~/.hermes/logs/agent.log` and `desktop.log`:

```
07:00:44  WARNING [cron_472aa86544a3_20260726_070015] agent.tool_executor:
          Tool mcp__desktop__sps_write_page returned error (0.07s):
          {"error": "Desktop MCP error: fetch failed"}
```

`fetch failed` = the control server was unreachable. It did not bind until
`2026-07-26T02:23:32Z` — **07:53 IST**, ~53 minutes after the cron fired. The scheduled run
executed and produced its own job output (`cron/output/472aa86544a3/2026-07-26_07-00-55.md`),
but its vault write was refused. `vault/daily-brief-2026-07-25.md` then appeared at 07:54 —
a catch-up once the app was open, carrying the known UTC-vs-local filename bug (written on
the 26th, named for the 25th).

Do not trust file mtime/birth time here: the Dream Cycle rewrites briefs atomically to add
`summary:` frontmatter (`desktop.log` 10:11:45Z), which resets birth time. The tool-call log
line is the direct evidence.

**What this means:** the KNOWN CONSTRAINT below is not a footnote, it is the live failure
mode. The engine can only write while the desktop app is running, and on a normal night the
app is closed at 07:00. **The thin slice's unattended success criterion is NOT yet met.**
Either the cron has to move to a time the app is reliably open, or the closed-app lane needs
a headless control server.

### RESOLVED 2026-07-26 — what actually shuts the door, and why the click never worked

Both earlier accounts (the "catch-22" below, and the "overstated" correction after it) are
superseded. Read at source:

1. **The door-closer is `checkCapabilityRisks`, not `admitMcpCapability`.**
   `src/main/capability-risk.ts:154-159` force-disables any MCP server that is enabled but
   whose `reviewState !== "reviewed"`, on every risk check (6-hourly + at startup). It wrote
   `enabled: false` into `config.yaml` at 07:54 today. **This is correct policy, not a bug** —
   an unreviewed server that grants vault-write should be off. The only cure is a real review.

2. **`reviewCapabilityRisk` does NOT consult the gate.** It calls the _synchronous_
   `setMcpServerEnabled` from `installer/mcp.ts:164` (the `./installer` barrel re-export),
   which writes `enabled: true` straight to config. There is no catch-22 in the review path.
   The `admitMcpCapability`-based `setMcpServerEnabled` in `mcp-servers.ts:587` is a
   different function used by the MCP Servers manager. Two same-named exports — easy to
   misread, and both earlier diagnoses did.

3. **The owner's click never reached the handler.** Decisive evidence: `lastReviewedAt` is
   written unconditionally by `reviewCapabilityRisk` and is preserved across rescans
   (`capability-risk-store.ts:494/537/577`), yet **0 of 138 reports have it**. No
   `capability-risk` line appears in `desktop.log`, and IPC failures do log. There is exactly
   one caller in the whole tree (`CapabilitySummary.tsx:120`).

4. **Why it never reached it:** the surface rendered **138 identical unlabeled "Mark
   reviewed" buttons** in one flowing div under a single "Review needed:" label, with no
   pending state, no success feedback, and `void` swallowing rejections. A hit, a miss, and a
   failure were indistinguishable. Fixed on `fix/capability-review-feedback`: per-row
   `aria-label`, a visible count, a "Reviewing…" state, and errors surfaced via `role="alert"`.
   `reviewCapabilityRisk` now saves the review before enabling, throws instead of dropping a
   failed enable, and no longer wipes `registry.scanners`.

**Still required: the owner clicks once.** Settings (⌘,) → Application Health → "Review
needed" → the `desktop (mcp) - safe` row. Nothing else opens it, and an agent must not open
it for you.

### (superseded) CORRECTION to the "catch-22" claim below — it was overstated

The section below asserts that an open app re-disables `mcp:desktop` before the engine can
use it. **That is wrong, and it was inferred from a single observation.** What is actually
true:

- The gate **did** write `enabled: false` into `config.yaml` once (observed pre-repoint).
- It has **not** done so since. `config.yaml` has held `enabled: true` throughout, the
  engine loaded `desktop-mcp.cjs` from the installed bundle (PID 63677), and the 07:00 run
  wrote its page normally.
- The registry still reads `{"id":"mcp:desktop","reviewState":"needsReview","enabled":false}`
  — so the **report** says disabled while the **config** says enabled, and the engine
  follows the config.

So the risk is real but **intermittent and not currently blocking**: some code path can
write `enabled: false` into config, and when it fires the door shuts. Worth pinning down
exactly which path and when — but it is NOT the hard blocker described below, and it did
NOT prevent the proof. Approving the `desktop` capability in the review UI remains the
clean fix.

## (SUPERSEDED, overstated) BLOCKER FOUND AFTER THE INSTALL — the capability gate

**The install is DONE** (see below). But the door is shut again, by our own newest feature.

`admitMcpCapability` (`src/main/capability-risk-store.ts:604`):

```ts
const allowed =
  initial.reviewState === "reviewed" && initial.status !== "blocked";
const effective = { ...requested, enabled: requested.enabled && allowed };
```

Commit **`7fb862cf` "trustworthy delegated work controls"** (newest commit on `main`,
landed independently of this branch) **force-writes `enabled: false` into `config.yaml`
for any MCP server whose capability-risk report is not `reviewed`.** And
`reviewStateFor` (`:280-295`) resets to `needsReview` whenever the bundle fingerprint
changes — which the worktree→`/Applications` swap just did.

Live registry (`~/.hermes/sps-agent/capability-risk-report.json`):

```json
{
  "id": "mcp:desktop",
  "reviewState": "needsReview",
  "status": "safe",
  "enabled": false
}
```

### The catch-22 this creates

- **App closed** → no control server on 8645 → `sps_write_page` has nothing to POST to.
- **App open** → the capability scan re-disables `mcp:desktop` → the engine never gets the
  tool at all.

The 21:40 proof landed in the narrow window where the app was up and a rescan had not yet
run. **W1 (the MCP door) and `7fb862cf` (capability controls) were built independently and
are in direct conflict. Resolving this is now the top Phase 2 item — ahead of W6.**

### What was deliberately NOT done

**The registry was not hand-edited to `"reviewed"`.** That field is a human security
approval for a capability that can write into the vault; forging it while the owner was
away would defeat the entire point of the feature. `config.yaml`'s `enabled` flag (owner
_intent_) was restored to `true`; `reviewState` (owner _approval_) was left untouched.

### Owner action required — one click

Approve the **desktop** MCP capability in the app's capability-review surface. Once
`reviewState` is `reviewed`, config `enabled: true` + `status: safe` means
`admitMcpCapability` will let it through and the door stays open across restarts.

Also note `mcp:openalex` is `unreviewed`/disabled and two skills are `unreviewed`
(`native-mcp` is `status: blocked`) — same gate, worth a look in the same pass.

## The install — DONE (2026-07-26 ~00:10)

- `npm run build:mac` → **exit 0**. Signed with the real Developer ID
  (`Amar Sukhi, LJA377LKZF`), hardened runtime. 821 MB.
- Old app preserved as **`/Applications/Hermes Agent.old.app`** (24 Jul build) — the only
  rollback. Delete it once the new build has proven itself.
- New app installed via `ditto` to `/Applications/Hermes Agent.app`;
  `codesign --verify --deep --strict` passes; its bundled `desktop-mcp.cjs` contains
  `sps_write_page`.
- `~/.hermes/config.yaml` → `mcp_servers.desktop.args[0]` now
  `/Applications/Hermes Agent.app/Contents/Resources/app.asar.unpacked/resources/desktop-mcp.cjs`.
  74 top-level keys intact. Backup: `<scratchpad>/config.yaml.pre-repoint.bak`.
- **The app was NOT launched** and the 07:00 run will NOT write a page until the
  capability above is approved.

## Superseded: the earlier in-flight note (build has since finished)

Owner said "proceed and use your best judgement". The plan was: build a real app, install
it, repoint `config.yaml` off the worktree, leave it running for the 07:00 run.

**Status: `npm run build:mac` was STILL RUNNING when the session ended.** The app bundle
had been emitted at
`.worktrees/harness-thin-slice/dist/mac-arm64/Hermes Agent.app` but the command had not
exited (signing stage). Build log:
`<session-scratchpad>/build-mac.log` (scratchpad is ephemeral — just re-run if gone).

**Nothing was installed. `config.yaml` was NOT repointed. It still points at the worktree
bundle.** The system is exactly as described under "Machine state changed outside the
repo" below.

### Resume here — remaining steps in order

1. Finish / re-run `npm run build:mac` in the worktree. Verify exit 0.
2. **Move the old app aside rather than overwrite** — `/Applications/Hermes Agent.app`
   (809 MB, dated 24 Jul) is the last known-good build and the only rollback. Rename to
   `Hermes Agent.old.app`; disk had 32 GiB free.
3. Copy `dist/mac-arm64/Hermes Agent.app` → `/Applications/`.
4. Repoint `~/.hermes/config.yaml` → `mcp_servers.desktop.args[0]` to
   `/Applications/Hermes Agent.app/Contents/Resources/app.asar.unpacked/resources/desktop-mcp.cjs`
   (that is the path pattern the app itself uses — see the `installed bundled cron
artifact` log lines in `~/.hermes/logs/desktop.log`). Back up config.yaml first.
5. Launch the installed app. Confirm the control server is listening on **8645**
   (`lsof -nP -iTCP:8645 -sTCP:LISTEN`).
6. **RE-PROVE THE DOOR from the installed bundle** — do not assume the swap was
   transparent. `hermes cron run 472aa86544a3`, then confirm a fresh
   `daily-brief-<today>.md` appears in the vault. Repointing the MCP path is exactly the
   kind of change that looks fine and silently breaks the write path.
7. Leave the app running so the 07:00 job writes a page (see the constraint above).

Expect **two** briefs tomorrow: the engine's `daily-brief-YYYY-MM-DD.md` and
`dream-cycle`'s `Daily Brief - YYYY-MM-DD.md` (it wrote one at 21:40 tonight, minutes
after the engine's). That is the three-copies problem made visible — the concrete
argument for W4.

## ✅ W6 — CLOSED 2026-07-26. All four items shipped.

| Item                        | Commit                                           |
| --------------------------- | ------------------------------------------------ |
| W6.1 arrow keys escape      | `3b5a07e3` caret-edge guard + `isCaretAtEnd`     |
| W6.2 undo dies after typing | `aba9aaf1` decline-once, then rewind drift       |
| W6.4 paste (in)             | `c0420e68` `parsePlainText` → `markdownToBlocks` |
| W6.3 multi-block selection  | `b520a82a` `blockSelection.ts` + `Editor` keymap |

W6.3 shipped the range model the other three did not need: Escape selects the block,
Shift+Arrow at an edge grows into the neighbour, Shift+click extends, and a live range
answers Arrow / Shift+Arrow / Cmd+A / Backspace / Cmd+C-and-X (markdown via
`blocksToMarkdown`). Deleting to empty leaves one paragraph — a page with no
contentEditable cannot be refocused from the keyboard — and the window keymap ignores
events from real inputs so a Backspace in the Ask pane cannot eat blocks. **Still not
built:** drag-select hit-testing, and range-wide indent / type-change. Copy-out
(W6.4's second leg) is done and no longer blocked.

Gate: eslint 0 · all three typechecks 0 · vitest **3188 passed** (3164 + 24 new) exit 0 ·
`npm run build` exit 0 · `sps-smoke.mjs` 80 shots exit 0 · launchd plist hash unchanged.

### The original work order, kept for its evidence trail

The audit claims were re-verified rather than trusted (one item in the same list,
"Enter never splits a block", was already fixed in `76747db0` — so the list was known
stale). Two of four confirmed with exact mechanisms; two not yet checked.

### W6.1 — arrow keys escape the block on first press ✅ CONFIRMED

`Editable.tsx:160-162` calls `onArrow` on ArrowUp/ArrowDown with **no caret-boundary
guard** — so in any multi-line block the first ↓ jumps to the next block instead of moving
down a visual line. `Editor.tsx:308-318`'s `onArrow` unconditionally focuses the adjacent
block and calls `placeCaretEnd`.

**The tell:** the Backspace branch immediately above (`Editable.tsx:153-157`) _does_ guard,
with `isCaretAtStart(el)`. Adjacent branches, one guarded, one not.

**Fix shape:** guard ArrowUp with the existing `isCaretAtStart(el)`
(`selection.ts:149`, already unit-tested in `selection.test.ts`) and ArrowDown with a
caret-at-end predicate. **`selection.ts` has `placeCaretEnd` (`:101`) but NO
`isCaretAtEnd` predicate — that one small helper is the only new code needed.** Note a
correct fix should compare _visual line_ position, not just block start/end, or ↓ in a
wrapped 3-line paragraph still escapes early; block-boundary guarding is the minimum bar.

### W6.2 — undo silently stops working after any typing ✅ CONFIRMED

`blockEditing.ts:37-39`:

```ts
function sameBlocks(left: Block[], right: Block[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
```

`undo(current)` (`:171-177`) returns `null` unless `sameBlocks(current, entry.after)`.
Typing mutates blocks without pushing a history entry, so `current` diverges from
`entry.after` and **undo returns null — silently, no feedback**. Same for `redo`.

**Fix direction:** the fingerprint equality gate is the bug. Either push history entries
for text mutations (coalesced/debounced so one word ≠ 20 entries), or drop the
`sameBlocks` precondition and reconcile against current state. Prefer the former; the
latter risks restoring stale structure over newer edits. This one is data-loss-adjacent —
**highest severity of the four for user trust.**

### W6.3 — multi-block selection ✅ CONFIRMED ABSENT (and it is a feature, not a bug)

`grep -rn "selectedBlockIds\|selectedIds\|multiSelect\|blockSelection\|selectedBlocks" src/`
returns **nothing**. `SelectionToolbar.tsx` is inline text formatting _within_ one block
(bold/italic/link/colour/Ask-AI), not block selection. `Editor.tsx` carries no selection
state at all.

**Scope warning:** this is not a defect with a small fix — it is selection state, shift-click
and shift-arrow ranges, drag-select hit-testing, a rendered highlight, and then every
operation that must respect a range (delete, indent, drag, type-change, copy). Treat it as a
feature and brief it separately; do not fold it into a bug-fix pass.

### W6.4 — markdown clipboard round-trip ⚠️ PARTLY WRONG, and sharper than claimed

The claim was "missing". Both legs checked:

- **Paste (in): the capable parser existed and the paste path did not call it.**
  `Editable.tsx:99` → `parseClipboardBlocks` (`paste.ts:102`) prefers `text/html`; plain text
  fell to `parsePlainText`, which handled **only** `-`/`*`/`1.` list markers and indent.
  Headings, quotes, callouts, todos, fenced code and every inline mark arrived as literal
  characters in a `p` — while `markdownToBlocks` (`blockMarkdown.ts:525`), the inverse of the
  serializer that writes every vault page and golden-tested in `blockMarkdown.test.ts`, sat
  one import away. **FIXED** — `parsePlainText` now delegates to it.
- **Copy (out): genuinely absent.** No `onCopy`/`onCut` handler exists anywhere in `editor/`,
  so copying yields browser-default html. Multi-block copy-as-markdown is blocked on W6.3
  regardless, so it belongs with that feature, not with the paste fix.

**Security note for whoever touches this next:** `markdownToBlocks` decodes tier-2
`<!-- sps:… -->` comments through `decodeMeta` (`blockMarkdown.ts:42`), which `JSON.parse`s a
base64 payload straight into a `Block` — **including its `html`**. Clipboard content is
untrusted, so `parsePlainText` re-sanitizes every produced block's html. `paste.test.ts` has a
regression guard that pastes a crafted `<!-- sps:… -->` carrying `<script>`/`onerror` and
asserts neither survives. Do not drop that sanitize step.

### Method (repo Bug-Fix Protocol, CLAUDE.md)

Each of these is a bug, not a feature: Frame (user story + acceptance criteria) →
reproduce with a failing test → fix → prove. Renderer-logic tier: `npx vitest run <file>`
then `npm run typecheck`. Editor behaviour that needs a real caret/selection may not be
provable in jsdom — check whether it belongs in `scripts/sps-smoke.mjs` instead.
**Out of scope (Lazy-Dev Ladder):** virtualization/memoization and the O(n²)
`orderedListNumber`. Premature at a four-file vault.

## Phase 2 onward — W6 is done; W3/W4/W5 remain

**Next unblocked item is W4** (delete the reimplementations). W3 is gated on the owner's
Google Cloud OAuth, and W5 wants the `pre-subtraction-<version>` tag + `docs/DELETED.md`
written before a line is removed. The original ordering argument follows.

### (original) RECOMMENDED ORDER: W6 before W4/W5

The proof changes the priority. The vault's only user-authored content, ever, is the
single character `/` in `home.md` — the one gesture onboarding teaches. That is not a
user lost to 23 surfaces; that is a user who typed one character and never typed a
second. Now that the agent fills the vault, the owner's job is to **react** — and
reacting means editing. If the editor fails on the first keystroke, the agent's pages
are read-only artifacts and the loop dies exactly where it died before, just with better
content on screen. W4/W5 delete code that never ran: real hygiene, zero user-visible
gain, and they don't touch the editor, so they don't make W6 cheaper.

- **W6 (do first)** editor table stakes, scoped to the writing loop:
  arrow keys escape the block on first press (`Editor.tsx:308-318`); no multi-block
  selection at all; undo gated on a `JSON.stringify` fingerprint
  (`blockEditing.ts:173`) so it stops working after any typing; markdown clipboard
  round-trip missing though `markdownToBlocks` already exists (`blockMarkdown.ts:525`).
  **Explicitly out of scope:** virtualization/memoization and the O(n²)
  `orderedListNumber` — premature at a four-file vault (Lazy-Dev Ladder).
- **W3** wire the four loops as engine cron jobs whose prompts end "…write the result to
  a page": email → `~/.hermes/skills/gmail-triage/` (Gmail API + OAuth); research →
  `skills/research/recurring-digest-workflows/`; briefings → done by W2; cron → single
  dispatcher (W0.2). **Gated on a one-time manual Google Cloud OAuth setup by the owner**
  (`~/.hermes/skills/gmail-triage/references/oauth-setup.md`) — nothing in the repo can
  unblock this.
- **W4** delete ~10k LOC of reimplementation, only after each engine path is live.
- **W5** the 23→8 surface cut (owner keeps Graph + Obsidian). Tag
  `pre-subtraction-<version>` + `docs/DELETED.md` so revival is a `git checkout`.
- **W7** gates — `noImplicitAny: true` costs only **5 errors repo-wide** (verified).

## Gotchas earned here

- **Never pipe vitest through `tail`** — it masks the exit code. One run printed
  `exit code 0` while 8 tests failed. Redirect to a file and echo `$?`.
- **Never `git stash` while a suite runs in the same worktree** — invalidates the run.
- `vi.mock("os", …)` returns a hand-built object; any new `os` import (e.g. `tmpdir`)
  breaks every test file that mocks it.
- Test fixtures putting a production `HERMES_HOME` under `/tmp` now trip the
  ephemeral-home guard — use `/Users/test-owner/.hermes`.
- Code that opens the note index cannot run under vitest (Electron ABI) — prove it in
  `scripts/verify-note-index.ts`.
