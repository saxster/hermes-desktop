import { randomUUID } from "crypto";
import {
  AUTONOMY_POLICY_CONTRACT_VERSION,
  type AutonomyDecision,
  type AutonomyDecisionInput,
} from "../shared/autonomy-policy";
import { redactLedgerText } from "../shared/action-receipts";
import {
  assertRunWritablePath,
  matchingExternalActionGrant,
} from "./autonomy-grants";

interface AutonomyDecisionContext {
  targetWithinRunRoot?: boolean;
  matchingExternalGrantId?: string;
}

function clean(value: string | undefined, max = 240): string | undefined {
  if (!value?.trim()) return undefined;
  return redactLedgerText(value).slice(0, max);
}

export function evaluateAutonomyDecision(
  input: AutonomyDecisionInput,
  now = Date.now(),
  context: AutonomyDecisionContext = {},
): AutonomyDecision {
  const base = {
    contractVersion: AUTONOMY_POLICY_CONTRACT_VERSION,
    decisionId: `decision_${randomUUID()}`,
    runId: clean(input.runId, 160) || "unknown-run",
    mode: input.mode,
    risk: input.risk,
    action: clean(input.action, 160) || "unknown-action",
    toolName: clean(input.toolName, 120),
    target: clean(input.target),
    command: clean(input.command),
    createdAt: now,
  } as const;

  if (input.risk === "READ" && input.provenSafeRead) {
    return {
      ...base,
      allowed: true,
      needsUser: false,
      rule: "proven-safe-read",
      reason:
        "The action is a narrowly classified read with no write, execution, or external side effect.",
    };
  }

  if (input.mode === "READ_ONLY") {
    return {
      ...base,
      allowed: false,
      needsUser: false,
      rule: "read-only-mode-deny",
      reason:
        "This run is read-only and cannot perform unproven reads, writes, commands, or external actions.",
    };
  }

  if (input.risk === "UNKNOWN") {
    return {
      ...base,
      allowed: false,
      needsUser: true,
      rule: "unknown-fails-closed",
      reason:
        "The action could not be classified, so Hermes cannot run it automatically.",
    };
  }

  if (input.risk === "READ") {
    return {
      ...base,
      allowed: false,
      needsUser: true,
      rule: "unproven-read-needs-review",
      reason:
        "The action claims to read data, but its target or behavior was not proven safe.",
    };
  }

  if (input.risk === "WRITE_WORKSPACE") {
    if (input.mode === "SCOPED_AUTOMATION" && context.targetWithinRunRoot) {
      return {
        ...base,
        allowed: true,
        needsUser: false,
        rule: "run-root-write",
        reason:
          "The write target is inside a realpath-verified root granted only to this run.",
      };
    }
    return {
      ...base,
      allowed: false,
      needsUser: true,
      rule: "workspace-write-needs-scope",
      reason:
        "Workspace writes require a run-scoped root or an explicit one-time decision.",
    };
  }

  if (input.risk === "EXTERNAL") {
    if (input.mode === "SCOPED_AUTOMATION" && context.matchingExternalGrantId) {
      return {
        ...base,
        allowed: true,
        needsUser: false,
        rule: "exact-expiring-external-grant",
        reason:
          "An active grant matches this run, tool, and exact external target.",
        grantId: context.matchingExternalGrantId,
      };
    }
    return {
      ...base,
      allowed: false,
      needsUser: true,
      rule: "external-action-needs-exact-grant",
      reason:
        "External side effects require an unexpired grant for this exact run, tool, and target.",
    };
  }

  return {
    ...base,
    allowed: false,
    needsUser: true,
    rule: "exec-needs-user",
    reason:
      "Command execution is never covered by remembered or external grants.",
  };
}

export function resolveAutonomyDecisionContext(
  input: AutonomyDecisionInput,
  profile?: string,
): AutonomyDecisionContext {
  if (input.risk === "WRITE_WORKSPACE" && input.target) {
    try {
      assertRunWritablePath(input.runId, input.target, profile);
      return { targetWithinRunRoot: true };
    } catch {
      return { targetWithinRunRoot: false };
    }
  }
  if (input.risk === "EXTERNAL" && input.toolName && input.target) {
    const grant = matchingExternalActionGrant(
      input.runId,
      input.toolName,
      input.target,
      profile,
    );
    return { matchingExternalGrantId: grant?.id };
  }
  return {};
}
