export const HUMAN_ATTENTION_CONTRACT_VERSION = 1 as const;

export type HumanAttentionKind =
  | "approval"
  | "question"
  | "blocked-run"
  | "failed-run"
  | "notification"
  | "workspace-proposal";

export type HumanAttentionStatus =
  | "pending"
  | "resolved"
  | "dismissed"
  | "expired";

export interface HumanAttentionChoice {
  id: string;
  label: string;
  tone?: "default" | "primary" | "danger";
}

export interface HumanAttentionResumeRef {
  kind: "active-work" | "assistant-recipe" | "scheduled-research" | "chat";
  ref: string;
}

export interface HumanAttentionResolution {
  choiceId: string;
  resolvedAt: number;
  resolvedBy: "desktop" | "automation" | "system";
  note?: string;
}

export interface HumanAttentionItem {
  contractVersion: typeof HUMAN_ATTENTION_CONTRACT_VERSION;
  id: string;
  profile: string;
  kind: HumanAttentionKind;
  status: HumanAttentionStatus;
  source: string;
  title: string;
  summary: string;
  idempotencyKey: string;
  runId?: string;
  sessionId?: string;
  requestId?: string;
  toolCallId?: string;
  proposalId?: string;
  choices: HumanAttentionChoice[];
  resume?: HumanAttentionResumeRef;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  resolution?: HumanAttentionResolution;
}

export interface HumanAttentionCreateInput {
  kind: HumanAttentionKind;
  source: string;
  title: string;
  summary: string;
  idempotencyKey: string;
  runId?: string;
  sessionId?: string;
  requestId?: string;
  toolCallId?: string;
  proposalId?: string;
  choices?: HumanAttentionChoice[];
  resume?: HumanAttentionResumeRef;
  expiresAt?: number;
}

export interface HumanAttentionResolveInput {
  choiceId: string;
  resolvedBy?: HumanAttentionResolution["resolvedBy"];
  note?: string;
}

export interface HumanAttentionResolveResult {
  ok: boolean;
  item?: HumanAttentionItem;
  alreadyResolved?: boolean;
  error?: string;
}

export interface HumanAttentionListOptions {
  status?: HumanAttentionStatus | "all";
  limit?: number;
}

export interface HumanAttentionCounts {
  pending: number;
  approvals: number;
  questions: number;
  blockers: number;
  failures: number;
  notifications: number;
  proposals: number;
}
