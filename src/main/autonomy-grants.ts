import { existsSync, readFileSync, realpathSync, statSync } from "fs";
import { isAbsolute, join, relative, resolve, dirname, basename } from "path";
import { randomUUID } from "crypto";
import {
  AUTONOMY_POLICY_CONTRACT_VERSION,
  type AutonomyGrant,
  type CreateExternalActionGrantInput,
  type CreateRunWritableRootGrantInput,
  type ExternalActionGrant,
  type RunWritableRootGrant,
} from "../shared/autonomy-policy";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";

const STORE_FILE = "autonomy-grants.json";
const MAX_GRANT_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const FORBIDDEN_EXTERNAL_TOOL =
  /(^|[_.:-])(shell|terminal|exec|delete|remove|rm)($|[_.:-])/i;
const WILDCARD_TARGET = /[*{}[\]]/;

function storePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    STORE_FILE,
  );
}

function isGrant(value: unknown): value is AutonomyGrant {
  if (!value || typeof value !== "object") return false;
  const grant = value as Partial<AutonomyGrant>;
  const baseValid =
    grant.contractVersion === AUTONOMY_POLICY_CONTRACT_VERSION &&
    typeof grant.id === "string" &&
    typeof grant.runId === "string" &&
    typeof grant.createdAt === "number" &&
    Number.isFinite(grant.createdAt) &&
    typeof grant.expiresAt === "number" &&
    Number.isFinite(grant.expiresAt) &&
    (grant.revokedAt === undefined ||
      (typeof grant.revokedAt === "number" &&
        Number.isFinite(grant.revokedAt)));
  if (!baseValid) return false;
  if (grant.kind === "workspace-root") {
    return typeof (grant as RunWritableRootGrant).root === "string";
  }
  if (grant.kind === "external-action") {
    const external = grant as ExternalActionGrant;
    return (
      typeof external.toolName === "string" &&
      typeof external.target === "string"
    );
  }
  return false;
}

function readGrants(profile?: string): AutonomyGrant[] {
  const path = storePath(profile);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!Array.isArray(parsed))
      throw new Error("grant store root is not an array");
    return parsed.filter(isGrant);
  } catch (error) {
    throw new Error(
      `Autonomy grants could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeGrants(grants: AutonomyGrant[], profile?: string): void {
  safeWriteFile(storePath(profile), `${JSON.stringify(grants, null, 2)}\n`);
}

function required(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required.`);
  }
  const normalized = value.trim();
  if (
    normalized.length > max ||
    [...normalized].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function validateExpiry(expiresAt: number, now: number): void {
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("Grant expiry must be in the future.");
  }
  if (expiresAt - now > MAX_GRANT_LIFETIME_MS) {
    throw new Error("Grant lifetime cannot exceed 24 hours.");
  }
}

function isActive(grant: AutonomyGrant, now: number): boolean {
  return !grant.revokedAt && grant.expiresAt > now;
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

function resolveWritableTarget(target: string): string {
  const absolute = resolve(required(target, "Write target"));
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  if (!existsSync(parent)) {
    throw new Error("The write target parent directory must already exist.");
  }
  return join(realpathSync(parent), basename(absolute));
}

export function grantRunWritableRoot(
  input: CreateRunWritableRootGrantInput,
  profile?: string,
): RunWritableRootGrant {
  const now = Date.now();
  validateExpiry(input.expiresAt, now);
  const runId = required(input.runId, "Run id", 160);
  const root = realpathSync(resolve(required(input.root, "Workspace root")));
  if (!statSync(root).isDirectory())
    throw new Error("Workspace root is not a directory.");
  const existing = readGrants(profile).find(
    (grant): grant is RunWritableRootGrant =>
      grant.kind === "workspace-root" &&
      grant.runId === runId &&
      grant.root === root &&
      isActive(grant, now),
  );
  if (existing) return existing;
  const grant: RunWritableRootGrant = {
    contractVersion: AUTONOMY_POLICY_CONTRACT_VERSION,
    id: `grant_${randomUUID()}`,
    kind: "workspace-root",
    runId,
    root,
    createdAt: now,
    expiresAt: input.expiresAt,
  };
  writeGrants([...readGrants(profile), grant], profile);
  return grant;
}

export function assertRunWritablePath(
  runId: string,
  target: string,
  profile?: string,
): string {
  const normalizedRunId = required(runId, "Run id", 160);
  const normalizedTarget = resolveWritableTarget(target);
  const roots = readGrants(profile).filter(
    (grant): grant is RunWritableRootGrant =>
      grant.kind === "workspace-root" &&
      grant.runId === normalizedRunId &&
      isActive(grant, Date.now()),
  );
  if (!roots.some((grant) => isWithin(grant.root, normalizedTarget))) {
    throw new Error(
      "Write target is outside this run's granted workspace roots.",
    );
  }
  return normalizedTarget;
}

function normalizeExternalTarget(target: string): string {
  const normalized = required(target, "External target", 500);
  const isHttpUrl = /^https?:\/\//i.test(normalized);
  if (
    WILDCARD_TARGET.test(normalized) ||
    (!isHttpUrl && normalized.includes("?")) ||
    isAbsolute(normalized) ||
    normalized.startsWith(".") ||
    normalized.startsWith("~") ||
    normalized.toLowerCase().startsWith("file:")
  ) {
    throw new Error("External grants require one exact non-file target.");
  }
  return normalized;
}

export function grantExternalAction(
  input: CreateExternalActionGrantInput,
  profile?: string,
): ExternalActionGrant {
  const now = Date.now();
  validateExpiry(input.expiresAt, now);
  const runId = required(input.runId, "Run id", 160);
  const toolName = required(input.toolName, "Tool name", 120);
  if (
    !/^[A-Za-z0-9_.:-]+$/.test(toolName) ||
    FORBIDDEN_EXTERNAL_TOOL.test(toolName)
  ) {
    throw new Error("Shell, delete, and unknown tool grants are not allowed.");
  }
  const target = normalizeExternalTarget(input.target);
  const existing = readGrants(profile).find(
    (grant): grant is ExternalActionGrant =>
      grant.kind === "external-action" &&
      grant.runId === runId &&
      grant.toolName === toolName &&
      grant.target === target &&
      isActive(grant, now),
  );
  if (existing) return existing;
  const grant: ExternalActionGrant = {
    contractVersion: AUTONOMY_POLICY_CONTRACT_VERSION,
    id: `grant_${randomUUID()}`,
    kind: "external-action",
    runId,
    toolName,
    target,
    createdAt: now,
    expiresAt: input.expiresAt,
  };
  writeGrants([...readGrants(profile), grant], profile);
  return grant;
}

export function matchingExternalActionGrant(
  runId: string,
  toolName: string,
  target: string,
  profile?: string,
): ExternalActionGrant | null {
  const now = Date.now();
  return (
    readGrants(profile).find(
      (grant): grant is ExternalActionGrant =>
        grant.kind === "external-action" &&
        grant.runId === runId &&
        grant.toolName === toolName &&
        grant.target === target &&
        isActive(grant, now),
    ) ?? null
  );
}

export function listAutonomyGrants(
  profile?: string,
  includeInactive = false,
): AutonomyGrant[] {
  const now = Date.now();
  return readGrants(profile).filter(
    (grant) => includeInactive || isActive(grant, now),
  );
}

export function revokeAutonomyGrant(id: string, profile?: string): boolean {
  const grants = readGrants(profile);
  const grant = grants.find((candidate) => candidate.id === id);
  if (!grant) return false;
  if (!grant.revokedAt) grant.revokedAt = Date.now();
  writeGrants(grants, profile);
  return true;
}

export function revokeRunAutonomyGrants(
  runId: string,
  profile?: string,
): number {
  const grants = readGrants(profile);
  const now = Date.now();
  let count = 0;
  for (const grant of grants) {
    if (grant.runId === runId && isActive(grant, now)) {
      grant.revokedAt = now;
      count += 1;
    }
  }
  if (count) writeGrants(grants, profile);
  return count;
}
