import { safeHandle } from "./safe-handle";
import {
  checkCapabilityRisks,
  getCapabilityRiskSummary,
  reviewCapabilityRisk,
} from "../capability-risk";
import { listAutonomyGrants, revokeAutonomyGrant } from "../autonomy-grants";
import { listAutonomyDecisions } from "../autonomy-decision-store";

export function registerCapabilityRiskIpc(): void {
  safeHandle("capability-risk-summary", (_event, profile?: string) =>
    getCapabilityRiskSummary(profile),
  );
  safeHandle("capability-risk-check-now", (_event, profile?: string) =>
    checkCapabilityRisks(profile),
  );
  safeHandle("capability-risk-review", (_event, id: string, profile?: string) =>
    reviewCapabilityRisk(id, profile),
  );
  safeHandle(
    "autonomy-grants-list",
    (_event, includeInactive?: boolean, profile?: string) =>
      listAutonomyGrants(profile, includeInactive ?? false),
  );
  safeHandle("autonomy-grant-revoke", (_event, id: string, profile?: string) =>
    revokeAutonomyGrant(id, profile),
  );
  safeHandle(
    "autonomy-decisions-list",
    (_event, runId?: string, limit?: number, profile?: string) =>
      listAutonomyDecisions(runId, limit ?? 100, profile),
  );
}
