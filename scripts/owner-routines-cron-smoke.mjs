#!/usr/bin/env node
// Isolated smoke for owner-critical engine cron bootstrap.
//
// This exercises the real owner-routines -> createCronJob path while replacing
// the Hermes Python CLI with a temp shim. It proves desktop-side cron creation,
// first-run-manual pause, schedule, delivery target, and prompt shape without
// touching the production HERMES_HOME or creating real engine cron jobs.
import { execFile } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const SMOKE_TMP_ROOT =
  process.env.HERMES_OWNER_ROUTINES_SMOKE_TMPDIR ||
  (process.platform === "darwin" ? "/private/tmp" : tmpdir());
const WATCHDOG_MS = 60_000;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

function fakePythonSource() {
  return `#!/usr/bin/env node
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const home = process.env.HERMES_HOME;
if (!home) {
  console.error("HERMES_HOME is required");
  process.exit(2);
}

const jobsPath = join(home, "cron", "jobs.json");

function readJobs() {
  try {
    const parsed = JSON.parse(readFileSync(jobsPath, "utf-8"));
    return Array.isArray(parsed) ? parsed : parsed.jobs || [];
  } catch {
    return [];
  }
}

function writeJobs(jobs) {
  mkdirSync(join(home, "cron"), { recursive: true });
  writeFileSync(jobsPath, JSON.stringify({ jobs }, null, 2));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] && args[0].endsWith("/hermes")) args.shift();
if (args[0] !== "cron") fail("expected cron command");

const command = args[1];
if (command === "create") {
  const schedule = args[2] || "";
  let cursor = 3;
  let prompt = "";
  if (args[cursor] && !args[cursor].startsWith("--")) {
    prompt = args[cursor];
    cursor += 1;
  }

  let name = "";
  let deliver = "local";
  while (cursor < args.length) {
    const flag = args[cursor];
    const value = args[cursor + 1] || "";
    if (flag === "--name") name = value;
    if (flag === "--deliver") deliver = value;
    cursor += 2;
  }

  const jobs = readJobs();
  const id = "owner-routine-smoke-" + String(jobs.length + 1).padStart(2, "0");
  jobs.push({
    id,
    name,
    schedule: { value: schedule },
    prompt,
    state: "active",
    enabled: true,
    deliver: [deliver],
  });
  writeJobs(jobs);
  console.log("Created job: " + id);
  process.exit(0);
}

if (command === "pause") {
  const id = args[2] || "";
  const jobs = readJobs();
  const job = jobs.find((item) => item.id === id);
  if (!job) fail("job not found: " + id);
  job.state = "paused";
  job.enabled = false;
  writeJobs(jobs);
  console.log("Paused job: " + id);
  process.exit(0);
}

fail("unsupported cron command: " + command);
`;
}

function runnerSource(paths) {
  return `
const { readFileSync, writeFileSync } = require("node:fs");
const { join, delimiter } = require("node:path");
const { Module } = require("node:module");

process.env.HOME = ${JSON.stringify(paths.root)};
process.env.HERMES_HOME = ${JSON.stringify(paths.home)};
process.env.NODE_PATH = [${JSON.stringify(paths.nodeModules)}, process.env.NODE_PATH]
  .filter(Boolean)
  .join(delimiter);
Module._initPaths();

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return {};
  }
}

async function main() {
  const {
    ensureOwnerCriticalCronJobs,
    ownerRoutineDefinitions,
  } = require(${JSON.stringify(paths.ownerRoutinesModule)});

  const result = await ensureOwnerCriticalCronJobs("default");
  const jobsPayload = readJson(join(process.env.HERMES_HOME, "cron", "jobs.json"));
  const jobs = Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [];
  const definitions = ownerRoutineDefinitions().map((definition) => ({
    id: definition.id,
    name: definition.name,
    schedule: definition.schedule,
    deliver: definition.deliver,
  }));

  writeFileSync(
    ${JSON.stringify(paths.resultPath)},
    JSON.stringify({ result, definitions, jobs }, null, 2),
  );
}

main().catch((err) => {
  writeFileSync(
    ${JSON.stringify(paths.resultPath)},
    JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2),
  );
  process.exit(1);
});
`;
}

async function bundleRunner(paths) {
  writeFileSync(paths.entryPath, runnerSource(paths));
  await build({
    entryPoints: [paths.entryPath],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: paths.bundlePath,
    external: ["electron", "better-sqlite3"],
    logLevel: "silent",
  });
}

function seedHermesCli(home) {
  const repo = join(home, "hermes-agent");
  const binDir = join(repo, "venv", "bin");
  mkdirSync(binDir, { recursive: true });
  const pythonPath = join(binDir, "python");
  const hermesPath = join(repo, "hermes");
  writeFileSync(pythonPath, fakePythonSource(), "utf-8");
  chmodSync(pythonPath, 0o755);
  writeFileSync(hermesPath, "#!/bin/sh\nexit 0\n", "utf-8");
  chmodSync(hermesPath, 0o755);
}

function assertSmokeResult(payload) {
  if (payload.error) throw new Error(payload.error);
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  if (jobs.length !== 2) {
    throw new Error(`expected 2 owner routine jobs, found ${jobs.length}`);
  }
  const byName = new Map(jobs.map((job) => [job.name, job]));
  const morning = byName.get("owner-routine:morning-brief");
  const triage = byName.get("owner-routine:overnight-triage");
  if (!morning || !triage) {
    throw new Error(
      `missing expected jobs: ${jobs.map((job) => job.name).join(", ")}`,
    );
  }

  for (const job of [morning, triage]) {
    if (job.state !== "paused" || job.enabled !== false) {
      throw new Error(`${job.name} was not paused for manual first run`);
    }
    if (!Array.isArray(job.deliver) || job.deliver[0] !== "local") {
      throw new Error(`${job.name} does not use local delivery`);
    }
    const prompt = String(job.prompt || "");
    if (!prompt.includes("context: review")) {
      throw new Error(`${job.name} prompt does not require review context`);
    }
    if (!prompt.includes("Do not mark it context: include.")) {
      throw new Error(`${job.name} prompt does not prohibit context include`);
    }
  }

  if (morning.schedule?.value !== "0 7 * * *") {
    throw new Error("morning brief schedule mismatch");
  }
  if (triage.schedule?.value !== "0 2 * * *") {
    throw new Error("overnight triage schedule mismatch");
  }
  if (
    !String(morning.prompt || "").includes(
      "Daily Brief - [local YYYY-MM-DD].md",
    )
  ) {
    throw new Error("morning brief prompt lacks stable dated filename");
  }
  if (
    !String(triage.prompt || "").includes(
      "Overnight Triage - [local YYYY-MM-DD].md",
    )
  ) {
    throw new Error("overnight triage prompt lacks stable dated filename");
  }

  return {
    status: "passed",
    created: payload.result?.created || [],
    existing: payload.result?.existing || [],
    failed: payload.result?.failed || [],
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      schedule: job.schedule?.value || job.schedule,
      state: job.state,
      enabled: job.enabled,
      deliver: job.deliver,
    })),
  };
}

async function runSmoke() {
  const root = mkdtempSync(
    join(SMOKE_TMP_ROOT, "hermes-owner-routines-smoke-"),
  );
  const home = join(root, ".hermes");
  mkdirSync(home, { recursive: true });
  seedHermesCli(home);

  const paths = {
    root,
    home,
    entryPath: join(root, "owner-routines-smoke-entry.cjs"),
    bundlePath: join(root, "owner-routines-smoke-bundle.cjs"),
    resultPath: join(root, "owner-routines-smoke-result.json"),
    nodeModules: join(process.cwd(), "node_modules"),
    ownerRoutinesModule: resolve("src/main/owner-routines.ts"),
  };

  await bundleRunner(paths);
  await execFileAsync(process.execPath, [paths.bundlePath], {
    env: {
      ...process.env,
      HOME: root,
      HERMES_HOME: home,
      NODE_PATH: [join(process.cwd(), "node_modules"), process.env.NODE_PATH]
        .filter(Boolean)
        .join(delimiter),
    },
    timeout: WATCHDOG_MS,
  });

  const payload = readJson(paths.resultPath);
  const result = assertSmokeResult(payload);
  return { ...result, hermesHome: home };
}

try {
  const result = await runSmoke();
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
