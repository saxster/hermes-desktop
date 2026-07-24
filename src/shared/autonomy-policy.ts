export const AUTONOMY_POLICY_CONTRACT_VERSION = 1 as const;

export type AutonomyRiskClass =
  | "READ"
  | "WRITE_WORKSPACE"
  | "EXEC"
  | "EXTERNAL"
  | "UNKNOWN";

export type AutonomyMode = "READ_ONLY" | "INTERACTIVE" | "SCOPED_AUTOMATION";

export interface AutonomyDecisionInput {
  runId: string;
  mode: AutonomyMode;
  risk: AutonomyRiskClass;
  action: string;
  toolName?: string;
  target?: string;
  command?: string;
  provenSafeRead?: boolean;
}

export interface AutonomyDecision {
  contractVersion: typeof AUTONOMY_POLICY_CONTRACT_VERSION;
  decisionId: string;
  runId: string;
  mode: AutonomyMode;
  risk: AutonomyRiskClass;
  action: string;
  toolName?: string;
  target?: string;
  command?: string;
  allowed: boolean;
  needsUser: boolean;
  rule: string;
  reason: string;
  grantId?: string;
  createdAt: number;
}

export interface RunWritableRootGrant {
  contractVersion: typeof AUTONOMY_POLICY_CONTRACT_VERSION;
  id: string;
  kind: "workspace-root";
  runId: string;
  root: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export interface ExternalActionGrant {
  contractVersion: typeof AUTONOMY_POLICY_CONTRACT_VERSION;
  id: string;
  kind: "external-action";
  runId: string;
  toolName: string;
  target: string;
  createdAt: number;
  expiresAt: number;
  revokedAt?: number;
}

export type AutonomyGrant = RunWritableRootGrant | ExternalActionGrant;

export interface CreateRunWritableRootGrantInput {
  runId: string;
  root: string;
  expiresAt: number;
}

export interface CreateExternalActionGrantInput {
  runId: string;
  toolName: string;
  target: string;
  expiresAt: number;
}
