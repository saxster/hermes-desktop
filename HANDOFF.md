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

## State: 7 commits, tree clean, NOT pushed, NOT merged

| Commit     | Work                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| `85642929` | W0.1 refuse to install the machine-global LaunchAgent for an ephemeral `HERMES_HOME` |
| `0b242309` | W0.3 note-index WAL checkpoint (timer + on close)                                    |
| `92a2ad3a` | W0.4 stop double-wrapping frontmatter in daily briefs                                |
| `852271aa` | W0.2 defer cron dispatch to the engine ticker when it is alive                       |
| `3c78acf2` | **W1 the MCP door** — `sps_write_page` / `sps_write_capture` / `sps_create_task`     |
| `efb5df61` | W2 engine writes its brief as a page + prompt-comparison fix                         |
| `691d4661` | rebuilt `resources/desktop-mcp.cjs` (tracked; config points at it)                   |

**Gate green:** 3 typecheck projects → eslint → **3147 vitest pass** →
`verify:note-index` → `npm run build`. Every fix has a regression test proven to fail
without it.

## NEXT STEP — one manual action, then the proof

Two things are still stale on the live system: the cron job's prompt does not mention
`sps_write_page`, and the running gateway has not loaded the MCP server.

Both close by running **this** build once:

```bash
# quit the /Applications Hermes Agent app first
cd /Users/amar/Desktop/MyCode/fathah_hermes/.worktrees/harness-thin-slice
npm run dev
```

That restarts the gateway (loading the MCP server) and runs `syncOwnerDailyBriefCron`
(`src/main/index.ts:980`, `:993`), which rewrites the prompt.

### THE PROOF — 2026-07-26, ~07:00 (`next_run_at` = `2026-07-26T07:00:00+05:30`)

A page written by the **engine** appears at
`~/.hermes/sps-agent/vault/daily-brief-2026-07-26.md`, with a single frontmatter block,
findable via ⌘K in the app.

**If it does not appear: STOP and diagnose. Do not start Phase 2 deletion.**

Diagnostic order if it fails:

1. `ps aux | grep desktop-mcp.cjs` — did the gateway spawn the MCP server?
2. Does the stored prompt contain `sps_write_page`? (read `~/.hermes/cron/jobs.json`)
3. `~/.hermes/cron/output/70a4fd959098/` — did the run happen at all?
4. `~/.hermes/logs/desktop.log` — scope `control-server` for rejected writes.

## Machine state changed outside the repo

- `~/Library/LaunchAgents/com.nousresearch.hermes-scheduler.plist` — repaired to point
  at `~/.hermes` and reloaded. **Verified live:** `launchctl` status 0, ticks every 60s,
  zero errors, correct `desktop-alive.skip` while the app is open.
- `~/.hermes/config.yaml` — `mcp_servers.desktop` now `enabled: true`,
  `command: /opt/homebrew/bin/node`, args → this worktree's `resources/desktop-mcp.cjs`.
  **This is a dev path in a live config** — repoint it at the installed app's bundle
  once a real build ships, or MCP breaks if this worktree is removed.
- Deleted stale `~/.hermes/bin/hermes-cron.js` (13 Jul).

## Phase 2 onward (re-plan after the proof)

- **W3** wire the four loops as engine cron jobs whose prompts end "…write the result to
  a page": email → `~/.hermes/skills/gmail-triage/` (Gmail API + OAuth); research →
  `skills/research/recurring-digest-workflows/`; briefings → done by W2; cron → single
  dispatcher (W0.2).
- **W4** delete ~10k LOC of reimplementation, only after each engine path is live.
- **W5** the 23→8 surface cut (owner keeps Graph + Obsidian). Tag
  `pre-subtraction-<version>` + `docs/DELETED.md` so revival is a `git checkout`.
- **W6** editor table stakes — arrow keys escape the block on first press; no
  multi-block selection; undo unreliable; no virtualization; no markdown clipboard.
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
