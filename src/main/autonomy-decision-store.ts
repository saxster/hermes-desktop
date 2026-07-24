import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import type {
  AutonomyDecision,
  AutonomyDecisionInput,
} from "../shared/autonomy-policy";
import { getActiveProfileNameSync, profileHome } from "./utils";
import {
  evaluateAutonomyDecision,
  resolveAutonomyDecisionContext,
} from "./autonomy-policy";

const DECISION_LOG = "autonomy-decisions.jsonl";

function decisionPath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "logs",
    DECISION_LOG,
  );
}

export function decideAndRecordAutonomy(
  input: AutonomyDecisionInput,
  profile?: string,
): AutonomyDecision {
  const decision = evaluateAutonomyDecision(
    input,
    Date.now(),
    resolveAutonomyDecisionContext(input, profile),
  );
  const path = decisionPath(profile);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(decision)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  return decision;
}

function isDecision(value: unknown): value is AutonomyDecision {
  if (!value || typeof value !== "object") return false;
  const decision = value as Partial<AutonomyDecision>;
  return (
    decision.contractVersion === 1 &&
    typeof decision.decisionId === "string" &&
    typeof decision.runId === "string" &&
    (decision.mode === "READ_ONLY" ||
      decision.mode === "INTERACTIVE" ||
      decision.mode === "SCOPED_AUTOMATION") &&
    (decision.risk === "READ" ||
      decision.risk === "WRITE_WORKSPACE" ||
      decision.risk === "EXEC" ||
      decision.risk === "EXTERNAL" ||
      decision.risk === "UNKNOWN") &&
    typeof decision.action === "string" &&
    typeof decision.allowed === "boolean" &&
    typeof decision.needsUser === "boolean" &&
    typeof decision.rule === "string" &&
    typeof decision.reason === "string" &&
    typeof decision.createdAt === "number" &&
    Number.isFinite(decision.createdAt)
  );
}

export function listAutonomyDecisions(
  runId?: string,
  limit = 500,
  profile?: string,
): AutonomyDecision[] {
  const path = decisionPath(profile);
  if (!existsSync(path)) return [];
  const rows: AutonomyDecision[] = [];
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isDecision(parsed) && (!runId || parsed.runId === runId))
        rows.push(parsed);
    } catch {
      // One malformed historical row must not hide later valid decisions.
    }
  }
  return rows.slice(-Math.min(Math.max(Math.floor(limit), 1), 2_000));
}
