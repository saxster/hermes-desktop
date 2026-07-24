// autonomy.ts — typed command classification for gateway approvals.
//
// The gateway asks the desktop to approve risky operations (hermes.approval.request).
// Every mode allows only provably-safe, read-only terminal commands without a
// prompt. Read-only mode denies everything else; interactive/scoped modes leave
// consequential requests for the central decision engine and user review. This
// is an ALLOWLIST, not a denylist, because the host holds sensitive user data.
//
// Pure + dependency-free so it is unit-testable; the config gate + the actual
// approve/deny call live in the IPC layer (index.ts).
import type { ApprovalRequest } from "./sse-parser";
import type {
  AutonomyDecision,
  AutonomyDecisionInput,
  AutonomyMode,
} from "../shared/autonomy-policy";
import { evaluateAutonomyDecision } from "./autonomy-policy";

// Single, well-known inspection binaries with NO mutating or launching power.
// `git` is allowed only for the read-only subcommands enumerated below.
//
// Deliberately EXCLUDED even though they look read-only (security review):
//   • env / printenv — `env` is a meta-launcher (`env FOO=1 rm -rf /` has binary
//     "env" and no shell metachars), and `printenv` leaks secrets/credentials.
//   • find — `find . -delete` / `-exec` mutate, and `-delete` carries no shell
//     metacharacter so it would slip past the metachar gate.
//   • sort — `sort -o FILE` writes a file.
// When unsure, leave a binary OUT: the cost is a prompt, the cost of a wrong
// inclusion is an auto-approved destructive action.
const SAFE_BINARIES = new Set([
  "ls",
  "pwd",
  "cat",
  "echo",
  "whoami",
  "date",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "stat",
  "file",
  "which",
  "ps",
  "df",
  "du",
  "tree",
  "id",
  "uname",
  "hostname",
  "cut",
  "uniq",
  "git",
]);

const SAFE_GIT_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "describe",
  "rev-parse",
  "blame",
  "shortlog",
  "tag",
]);

// Any shell metacharacter means we can no longer reason about the command as a
// single safe invocation (chaining, redirection, substitution, globbing, etc.) —
// fail closed.
const SHELL_METACHARS = /[;&|<>`$(){}\\!*?~\n\r]/;

function hasUnsafePathOperand(parts: string[]): boolean {
  return parts.slice(1).some((arg) => {
    if (!arg || arg.startsWith("-")) return false;
    return (
      arg.startsWith("/") ||
      /^[A-Za-z]:\//.test(arg) ||
      arg === "." ||
      arg === ".." ||
      arg.startsWith("../") ||
      arg.includes("/../") ||
      arg.endsWith("/..") ||
      arg.startsWith(".") ||
      arg.includes("/.")
    );
  });
}

/**
 * Is this a single, read-only terminal command we can safely auto-approve?
 * Conservative: rejects anything with shell metacharacters, anything whose
 * binary is not on the allowlist, and any `git` invocation that is not a
 * read-only subcommand.
 */
export function isCommandSafe(command: string): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  if (SHELL_METACHARS.test(cmd)) return false;
  const parts = cmd.split(/\s+/);
  const binary = parts[0];
  if (!SAFE_BINARIES.has(binary)) return false;
  if (binary === "git") {
    const subcommand = parts[1] ?? "";
    if (!SAFE_GIT_SUBCOMMANDS.has(subcommand)) return false;
    // Restrict dangerous arguments that could bypass read-only mode or execute programs
    const dangerousGitArgs = [
      /^-c$/,
      /^--config$/,
      /^--ext-cmd/,
      /^--exec-path/,
      /^--output/,
      /^--pager/,
      /^-P$/,
    ];
    for (let i = 2; i < parts.length; i++) {
      const arg = parts[i];
      if (dangerousGitArgs.some((pattern) => pattern.test(arg))) {
        return false;
      }
    }
    return true;
  }
  if (hasUnsafePathOperand(parts)) return false;
  return true;
}

/**
 * Decide whether a dangerous-command approval request is a proven-safe read.
 * Only terminal commands matched by `isCommandSafe` qualify;
 * a request with no command text (an unknown/structured tool action) can never
 * be proven safe, so it always prompts.
 */
export function canAutoApprove(req: ApprovalRequest): boolean {
  return evaluateAutonomyDecision(
    approvalAutonomyInput(req, "SCOPED_AUTOMATION"),
  ).allowed;
}

export function approvalAutonomyInput(
  req: ApprovalRequest,
  mode: AutonomyMode,
  runId = req.id,
): AutonomyDecisionInput {
  if (!req.command) {
    return {
      runId,
      mode,
      risk: "UNKNOWN",
      action: "gateway-approval",
      toolName: req.toolName,
    };
  }
  const safe = isCommandSafe(req.command);
  return {
    runId,
    mode,
    risk: safe ? "READ" : "EXEC",
    action: "gateway-command",
    toolName: req.toolName || "terminal",
    command: req.command,
    provenSafeRead: safe,
  };
}

export function automaticApprovalChoice(
  decision: AutonomyDecision,
): "once" | "deny" | null {
  if (decision.allowed) return "once";
  if (decision.mode === "READ_ONLY" && !decision.needsUser) return "deny";
  return null;
}
