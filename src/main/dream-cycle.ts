import { join } from "path";
import { mkdir, open, readFile, unlink } from "fs/promises";
import { existsSync } from "fs";
import { getSpsNoteIndex, parseFrontmatter } from "./note-index";
import { resolveSpsVaultDir } from "./sps-storage";
import { chatCompletionOnce } from "./hermes/chat-client";
import {
  getActiveProfileNameSync,
  pidIsAlive,
  profileHome,
  safeWriteFileAsync,
} from "./utils";
import { buildDailyBriefMarkdown, dailyBriefFileName } from "./daily-brief";
import { formatLogError, log } from "./log";
import {
  decideLockAcquisition,
  parseLockRecord,
  serializeLockRecord,
  type LockRecord,
} from "./scheduler-lock";
import YAML from "yaml";

const DREAM_CYCLE_LOCK_TIMEOUT_MS = 6 * 60 * 60 * 1_000;

interface DreamCycleLock {
  path: string;
  record: LockRecord;
}

async function acquireDreamCycleLock(
  profile: string,
): Promise<DreamCycleLock | null> {
  const lockDir = join(profileHome(profile), "locks");
  const lockPath = join(lockDir, "dream-cycle.lock");
  await mkdir(lockDir, { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const record: LockRecord = { pid: process.pid, startedAt: Date.now() };
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(serializeLockRecord(record), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { path: lockPath, record };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      let existing: LockRecord | null = null;
      try {
        existing = parseLockRecord(await readFile(lockPath, "utf8"));
      } catch (readErr) {
        if ((readErr as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw readErr;
      }

      const decision = decideLockAcquisition(
        existing,
        Date.now(),
        DREAM_CYCLE_LOCK_TIMEOUT_MS,
        pidIsAlive,
      );
      if (decision.type === "blocked") return null;

      try {
        await unlink(lockPath);
      } catch (unlinkErr) {
        if ((unlinkErr as NodeJS.ErrnoException).code !== "ENOENT") {
          throw unlinkErr;
        }
      }
    }
  }

  return null;
}

async function releaseDreamCycleLock(lock: DreamCycleLock): Promise<void> {
  try {
    const existing = parseLockRecord(await readFile(lock.path, "utf8"));
    if (
      existing?.pid === lock.record.pid &&
      existing.startedAt === lock.record.startedAt
    ) {
      await unlink(lock.path);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Summarizes a note's raw markdown text using the local LLM.
 */
async function generateSummary(
  title: string,
  content: string,
  profile?: string,
): Promise<string> {
  const prompt = `You are a knowledge gardening assistant for an agent's memory system.
Please provide a 1-sentence summary of the following note content.
Do not include any introductory phrases like "Here is a summary". Just output the clean summary string.

Note Title: ${title}
Note Content:
${content}`;

  const res = await chatCompletionOnce(
    [{ role: "user", content: prompt }],
    profile,
  );
  if (res.error) {
    throw new Error(`Failed to generate summary: ${res.error}`);
  }
  return res.content.trim().replace(/^["']|["']$/g, ""); // strip quotes
}

/**
 * Runs the Dream Cycle knowledge gardening task.
 */
export async function runDreamCycle(profile?: string): Promise<void> {
  const activeProfile = profile ?? getActiveProfileNameSync();
  const vaultDir = resolveSpsVaultDir(activeProfile);
  let cycleLock: DreamCycleLock | null = null;

  try {
    cycleLock = await acquireDreamCycleLock(activeProfile);
  } catch (err) {
    log.error("dream-cycle", {
      msg: "failed to acquire Dream Cycle lock; skipping unguarded run",
      profile: activeProfile,
      error: formatLogError(err),
    });
    return;
  }

  if (!cycleLock) {
    log.info("dream-cycle", {
      msg: "Dream Cycle already running; skipping",
      profile: activeProfile,
    });
    return;
  }

  log.info("dream-cycle", {
    msg: "starting Dream Cycle",
    vaultDir,
    profile: activeProfile,
  });

  try {
    const noteIndex = await getSpsNoteIndex(activeProfile);
    const notes = noteIndex.query({});

    // 1. Process and summarize notes
    const summarizedNotes: Array<{
      title: string;
      summary: string;
      path: string;
    }> = [];

    for (const note of notes) {
      const absPath = join(vaultDir, note.path);
      if (!existsSync(absPath)) continue;

      const raw = await readFile(absPath, "utf8");
      const { props, body } = parseFrontmatter(raw);

      // Summarize if summary does not exist or if note is very fresh
      let summary = props.summary as string | undefined;

      if (!summary) {
        log.info("dream-cycle", {
          msg: "summarizing note",
          path: note.path,
          profile: activeProfile,
        });
        try {
          summary = await generateSummary(note.title, body, activeProfile);
          props.summary = summary;

          // Serialize back to file
          const yamlStr = YAML.stringify(props).trim();
          const updatedContent = `---\n${yamlStr}\n---\n${body.startsWith("\n") ? body : "\n" + body}`;
          await safeWriteFileAsync(absPath, updatedContent);
          log.info("dream-cycle", {
            msg: "saved summary to frontmatter",
            path: note.path,
            profile: activeProfile,
          });
        } catch (err) {
          log.error("dream-cycle", {
            msg: "failed to summarize note",
            path: note.path,
            profile: activeProfile,
            error: formatLogError(err),
          });
        }
      }

      if (summary) {
        summarizedNotes.push({
          title: note.title,
          summary,
          path: note.path,
        });
      }
    }

    // 2. Fetch Gaps & Orphans
    const lintReport = noteIndex.lint();
    const missing = lintReport.brokenLinks
      .map((b) => `${b.source} -> [[${b.target}]] (${b.type})`)
      .join("\n");
    const orphans = lintReport.orphans.join("\n");

    const noteSummariesText = summarizedNotes
      .map((n) => `- **${n.title}** (${n.path}): ${n.summary}`)
      .join("\n");

    log.info("dream-cycle", {
      msg: "compiling Daily Brief",
      profile: activeProfile,
    });

    // 3. Generate Daily Brief via LLM
    const reportPrompt = `You are an AI Mentor gardening the agent's knowledge graph.
Analyze the following notes, missing pages, and orphans from the system, and generate a concise, review-first "Daily Brief" in Markdown format.

Active Notes & Summaries:
${noteSummariesText || "No active notes"}

Missing Notes (Linked but don't exist):
${missing || "None"}

Orphaned Notes (No incoming/outgoing links):
${orphans || "None"}

Generate a beautiful Markdown report containing:
1. **Daily Brief**: A short synthesis of today's workspace state.
2. **Changed or Active Pages**: Pages that look active, with one-line summaries.
3. **Open Loops**: Broken links, orphan notes, deadlines, or action items to review.
4. **Suggested Context**: Context the user may choose to opt into future assistant runs.

The generated page frontmatter will default to context: review. Do not imply it has been injected automatically.

Do not include any extra text outside the Markdown content.`;

    const res = await chatCompletionOnce(
      [{ role: "user", content: reportPrompt }],
      activeProfile,
    );
    if (res.error) {
      throw new Error(`Failed to compile report: ${res.error}`);
    }

    const today = new Date();
    const reportName = dailyBriefFileName(today);
    const reportPath = join(vaultDir, reportName);

    await safeWriteFileAsync(
      reportPath,
      buildDailyBriefMarkdown({ date: today, body: res.content }),
    );
    log.info("dream-cycle", {
      msg: "daily Brief saved",
      path: reportPath,
      profile: activeProfile,
    });

    // Trigger index rebuild to pick up the new Daily Brief note
    await noteIndex.rebuild();
  } catch (err) {
    log.error("dream-cycle", {
      msg: "error in dream cycle run",
      profile: activeProfile,
      error: formatLogError(err),
    });
  } finally {
    try {
      await releaseDreamCycleLock(cycleLock);
    } catch (err) {
      log.error("dream-cycle", {
        msg: "failed to release Dream Cycle lock",
        profile: activeProfile,
        error: formatLogError(err),
      });
    }
  }
}
