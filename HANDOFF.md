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

## Phase 2 onward — RECOMMENDED ORDER: W6 before W4/W5

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
