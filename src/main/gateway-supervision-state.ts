import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { GatewayHealthStatus } from "../shared/gateway";
import { HERMES_HOME } from "./installer";
import { safeWriteFile } from "./utils";

export interface GatewaySupervisionState {
  status: "healthy" | "recovering" | "outage";
  profile?: string;
  port?: number;
  lastCheckAt?: number;
  lastHealthyAt?: number;
  outageStartedAt?: number;
  recoveredAt?: number;
  lastOutageDurationMs?: number;
  lastRestartAttemptAt?: number;
  restartAttempts?: number;
  lastError?: string;
}

export function gatewaySupervisionStatePath(): string {
  return join(HERMES_HOME, "gateway-supervision.json");
}

export function readGatewaySupervisionState(): GatewaySupervisionState {
  const statePath = gatewaySupervisionStatePath();
  if (!existsSync(statePath)) return { status: "healthy" };
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "healthy" };
    }
    const state = parsed as Partial<GatewaySupervisionState>;
    return {
      ...state,
      status:
        state.status === "outage" || state.status === "recovering"
          ? state.status
          : "healthy",
    };
  } catch {
    return { status: "healthy" };
  }
}

export function reduceGatewaySupervisionState(
  previous: GatewaySupervisionState,
  health: GatewayHealthStatus,
  nowMs: number,
): GatewaySupervisionState {
  if (health === "healthy") {
    const recovered = previous.outageStartedAt
      ? {
          recoveredAt: nowMs,
          lastOutageDurationMs: Math.max(0, nowMs - previous.outageStartedAt),
        }
      : {};
    const next = {
      ...previous,
      ...recovered,
      status: "healthy" as const,
      lastCheckAt: nowMs,
      lastHealthyAt: nowMs,
    };
    delete next.outageStartedAt;
    return next;
  }

  return {
    ...previous,
    status: health === "recovering" ? "recovering" : "outage",
    lastCheckAt: nowMs,
    outageStartedAt: previous.outageStartedAt || nowMs,
  };
}

export function recordGatewaySupervisionHealth(
  health: GatewayHealthStatus,
  nowMs = Date.now(),
): GatewaySupervisionState {
  const next = reduceGatewaySupervisionState(
    readGatewaySupervisionState(),
    health,
    nowMs,
  );
  safeWriteFile(gatewaySupervisionStatePath(), JSON.stringify(next, null, 2));
  return next;
}
