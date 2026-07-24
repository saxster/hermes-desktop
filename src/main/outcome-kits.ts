import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  OUTCOME_KIT_CONTRACT_VERSION,
  type OutcomeKitActivationResult,
  type OutcomeKitDefinition,
  type OutcomeKitInstallation,
  type OutcomeKitReadiness,
  type OutcomeKitReadinessItem,
  type OutcomeKitSummary,
  validateOutcomeKit,
} from "../shared/outcome-kits";
import { resolveModelFitness } from "../shared/model-fitness";
import type {
  AssistantRecipePatch,
  AssistantRecipeRunResult,
} from "../shared/assistant-recipes";
import {
  createAssistantRecipe,
  listAssistantRecipes,
  runAssistantRecipe,
  updateAssistantRecipe,
} from "./assistant-recipes";
import { getModelConfig } from "./config";
import { listMcpServers } from "./mcp-servers";
import { listInstalledSkills } from "./skills";
import { validateChatReadiness } from "./validation";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";

const STORE_FILE = "outcome-kits.json";

function storePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "sps-agent",
    STORE_FILE,
  );
}

function isInstallation(value: unknown): value is OutcomeKitInstallation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<OutcomeKitInstallation>;
  return (
    row.contractVersion === OUTCOME_KIT_CONTRACT_VERSION &&
    typeof row.packHash === "string" &&
    typeof row.contentInstalledAt === "number" &&
    Array.isArray(row.importedSkills) &&
    !!row.kit &&
    row.kit.contractVersion === OUTCOME_KIT_CONTRACT_VERSION
  );
}

function readStore(profile?: string): OutcomeKitInstallation[] {
  const path = storePath(profile);
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("store root is not an array");
    if (!parsed.every(isInstallation))
      throw new Error("store contains an invalid installation row");
    for (const row of parsed) {
      const validation = validateOutcomeKit(row.kit);
      if (!validation.ok)
        throw new Error(
          `stored Outcome Kit ${row.kit.kitId || "unknown"} is invalid: ${validation.errors.join("; ")}`,
        );
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `Outcome Kits could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeStore(rows: OutcomeKitInstallation[], profile?: string): void {
  safeWriteFile(storePath(profile), `${JSON.stringify(rows, null, 2)}\n`);
}

function replace(
  rows: OutcomeKitInstallation[],
  next: OutcomeKitInstallation,
): OutcomeKitInstallation[] {
  return [next, ...rows.filter((row) => row.kit.kitId !== next.kit.kitId)];
}

function recipePatch(kit: OutcomeKitDefinition): AssistantRecipePatch {
  return {
    name: kit.recipe.name,
    description: kit.recipe.description,
    job: kit.recipe.job,
    inputs: kit.recipe.inputs,
    output: kit.recipe.output,
    allowedActions: kit.recipe.allowedActions,
    reviewMode: kit.reviewPolicy,
    outcome: kit.outcome,
    outcomeCriteria: kit.criteria,
    outcomeArtifacts: kit.artifacts,
    modelRequirements: kit.dependencies.model,
  };
}

export function registerOutcomeKitContent(
  kit: OutcomeKitDefinition,
  packHash: string,
  importedSkills: string[],
  profile?: string,
): OutcomeKitInstallation {
  const validation = validateOutcomeKit(kit);
  if (!validation.ok || !validation.kit) {
    throw new Error(`Invalid Outcome Kit: ${validation.errors.join("; ")}`);
  }
  if (!/^[a-f0-9]{64}$/i.test(packHash))
    throw new Error("Outcome Kit pack hash must be a SHA-256 hex digest.");
  if (
    importedSkills.some((skill) => typeof skill !== "string" || !skill.trim())
  )
    throw new Error("Outcome Kit imported skills are invalid.");
  kit = validation.kit;
  const rows = readStore(profile);
  const previous = rows.find((row) => row.kit.kitId === kit.kitId);
  const next: OutcomeKitInstallation = {
    contractVersion: OUTCOME_KIT_CONTRACT_VERSION,
    kit,
    packHash,
    contentInstalledAt: Date.now(),
    importedSkills: [...new Set(importedSkills)],
    recipeId: previous?.recipeId,
    activatedAt: previous?.activatedAt,
    scheduleEnabledAt: previous?.scheduleEnabledAt,
  };
  writeStore(replace(rows, next), profile);
  return next;
}

function toolNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((tool) => {
    if (typeof tool === "string") return [tool];
    if (
      tool &&
      typeof tool === "object" &&
      typeof (tool as { name?: unknown }).name === "string"
    ) {
      return [(tool as { name: string }).name];
    }
    return [];
  });
}

function overallStatus(
  items: OutcomeKitReadinessItem[],
): OutcomeKitReadiness["status"] {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.some((item) => item.status === "attention")) return "attention";
  return "ready";
}

export async function getOutcomeKitReadiness(
  kit: OutcomeKitDefinition,
  profile?: string,
): Promise<OutcomeKitReadiness> {
  const items: OutcomeKitReadinessItem[] = [];
  const installedSkills = new Set(
    listInstalledSkills(profile).map(
      (skill) => `${skill.category}/${skill.name}`,
    ),
  );
  for (const skill of kit.dependencies.skills) {
    const ready = installedSkills.has(skill);
    items.push({
      id: `skill:${skill}`,
      kind: "content",
      status: ready ? "ready" : "blocked",
      title: skill,
      summary: ready
        ? "Required skill content is installed."
        : "Required skill content is missing.",
    });
  }

  let servers: Awaited<ReturnType<typeof listMcpServers>> = [];
  try {
    servers = await listMcpServers(profile);
  } catch {
    // Each required connector becomes blocked below; no remote parity claim.
  }
  for (const connector of kit.dependencies.connectors) {
    const server = servers.find(
      (candidate) => candidate.name === connector.server,
    );
    const names = server ? toolNames(server.tools) : null;
    const toolReady = names?.includes(connector.tool) === true;
    const status = !server?.enabled
      ? connector.required
        ? "blocked"
        : "attention"
      : names === null
        ? "attention"
        : toolReady
          ? "ready"
          : connector.required
            ? "blocked"
            : "attention";
    items.push({
      id: `connector:${connector.server}:${connector.tool}`,
      kind: "connector",
      status,
      title: `${connector.server} / ${connector.tool}`,
      summary: !server?.enabled
        ? `Connector is not enabled. Needed for: ${connector.purpose}`
        : names === null
          ? "Connector is enabled, but this exact tool pin has not been verified by live discovery."
          : toolReady
            ? `Exact tool pin is available for: ${connector.purpose}`
            : "The connector is enabled but does not advertise the required tool.",
    });
  }

  const model = getModelConfig(profile);
  const modelFitness = resolveModelFitness(
    model.provider,
    model.model,
    kit.dependencies.model.capabilities,
  );
  items.push({
    id: "model",
    kind: "model",
    status:
      modelFitness.status === "mismatch" ||
      (kit.dependencies.model.requireVerified &&
        modelFitness.status !== "verified")
        ? "blocked"
        : modelFitness.status === "verified"
          ? "ready"
          : "attention",
    title: "Model fitness",
    summary: modelFitness.reason,
  });

  const chat = validateChatReadiness(profile);
  items.push({
    id: "chat",
    kind: "model",
    status: chat.ok ? "ready" : "blocked",
    title: "AI runtime",
    summary: chat.ok
      ? "The configured model and gateway are ready."
      : chat.message || "The AI runtime is not ready.",
  });

  items.push({
    id: "review-policy",
    kind: "review",
    status: "ready",
    title: "Review policy",
    summary:
      kit.reviewPolicy === "review-first"
        ? "Results stop for review before workspace or external changes land."
        : "Only low-risk, fully evidenced results may auto-complete.",
  });

  const permissionClasses = kit.risk.classes.filter((risk) => risk !== "READ");
  if (permissionClasses.length) {
    items.push({
      id: "permissions",
      kind: "permission",
      status: "attention",
      title: "Run permissions",
      summary: `${permissionClasses.join(", ")} authority is not bundled; it must be granted separately for an exact run and target.`,
    });
  }
  if (kit.scheduleTemplate) {
    items.push({
      id: "schedule",
      kind: "schedule",
      status: "attention",
      title: "Schedule template",
      summary:
        "The schedule is available but remains disabled until separately enabled.",
    });
  }

  const status = overallStatus(items);
  return {
    kitId: kit.kitId,
    status,
    canActivate: status !== "blocked",
    items,
    modelFitness,
    generatedAt: Date.now(),
  };
}

export async function listOutcomeKits(
  profile?: string,
): Promise<OutcomeKitSummary[]> {
  return Promise.all(
    readStore(profile).map(async (row) => ({
      ...row,
      readiness: await getOutcomeKitReadiness(row.kit, profile),
    })),
  );
}

export async function activateOutcomeKit(
  kitId: string,
  profile?: string,
): Promise<OutcomeKitActivationResult> {
  const rows = readStore(profile);
  const row = rows.find((candidate) => candidate.kit.kitId === kitId);
  if (!row) return { ok: false, error: "Outcome Kit is not installed." };
  const readiness = await getOutcomeKitReadiness(row.kit, profile);
  if (!readiness.canActivate) {
    return {
      ok: false,
      error: readiness.items
        .filter((item) => item.status === "blocked")
        .map((item) => item.summary)
        .join(" "),
    };
  }
  const existing = row.recipeId
    ? listAssistantRecipes(profile).find((recipe) => recipe.id === row.recipeId)
    : listAssistantRecipes(profile).find(
        (recipe) => recipe.outcomeKitId === row.kit.kitId,
      );
  let recipeId = existing?.id;
  if (recipeId) {
    const updated = await updateAssistantRecipe(
      recipeId,
      recipePatch(row.kit),
      profile,
    );
    if (!updated.ok) {
      return {
        ok: false,
        error: updated.error || "Could not update Outcome Kit.",
      };
    }
  } else {
    const created = await createAssistantRecipe(
      {
        ...row.kit.recipe,
        reviewMode: row.kit.reviewPolicy,
        outcomeKitId: row.kit.kitId,
        outcome: row.kit.outcome,
        outcomeCriteria: row.kit.criteria,
        outcomeArtifacts: row.kit.artifacts,
        modelRequirements: row.kit.dependencies.model,
        // Content activation never enables a schedule or grants authority.
      },
      profile,
    );
    if (!created.ok || !created.recipe) {
      return {
        ok: false,
        error: created.error || "Could not activate Outcome Kit.",
      };
    }
    recipeId = created.recipe.id;
  }
  const next: OutcomeKitInstallation = {
    ...row,
    recipeId,
    activatedAt: row.activatedAt || Date.now(),
  };
  writeStore(replace(rows, next), profile);
  return {
    ok: true,
    recipeId,
    kit: {
      ...next,
      readiness: await getOutcomeKitReadiness(next.kit, profile),
    },
  };
}

export async function enableOutcomeKitSchedule(
  kitId: string,
  profile?: string,
): Promise<OutcomeKitActivationResult> {
  const rows = readStore(profile);
  const row = rows.find((candidate) => candidate.kit.kitId === kitId);
  if (!row?.recipeId) {
    return {
      ok: false,
      error: "Activate the Outcome Kit before enabling its schedule.",
    };
  }
  if (!row.kit.scheduleTemplate) {
    return { ok: false, error: "This Outcome Kit has no schedule template." };
  }
  const updated = await updateAssistantRecipe(
    row.recipeId,
    {
      schedule: {
        enabled: true,
        cadence: row.kit.scheduleTemplate.cadence,
        hour: row.kit.scheduleTemplate.hour,
      },
    },
    profile,
  );
  if (!updated.ok) return { ok: false, error: updated.error };
  const next = { ...row, scheduleEnabledAt: Date.now() };
  writeStore(replace(rows, next), profile);
  return {
    ok: true,
    recipeId: row.recipeId,
    kit: {
      ...next,
      readiness: await getOutcomeKitReadiness(next.kit, profile),
    },
  };
}

export async function runOutcomeKit(
  kitId: string,
  inputs: Record<string, string>,
  profile?: string,
  trigger: "manual" | "scheduled" | "cron" | "proposal" | "external" = "manual",
): Promise<AssistantRecipeRunResult> {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) {
    return { ok: false, error: "Outcome Kit inputs must be an object." };
  }
  const rows = readStore(profile);
  const row = rows.find((candidate) => candidate.kit.kitId === kitId);
  if (!row?.recipeId) {
    return {
      ok: false as const,
      error: "Activate the Outcome Kit before running it.",
    };
  }
  if (!row.kit.triggerTemplates.includes(trigger)) {
    return {
      ok: false as const,
      error: `The ${trigger} trigger is not declared by this Outcome Kit.`,
    };
  }
  if (Object.values(inputs).some((value) => typeof value !== "string")) {
    return { ok: false, error: "Outcome Kit input values must be strings." };
  }
  const missing = row.kit.inputs.filter(
    (input) => input.required && !inputs[input.id]?.trim(),
  );
  if (missing.length) {
    return {
      ok: false as const,
      error: `Missing required inputs: ${missing.map((input) => input.label).join(", ")}.`,
    };
  }
  const readiness = await getOutcomeKitReadiness(row.kit, profile);
  if (!readiness.canActivate) {
    return { ok: false as const, error: "Outcome Kit readiness is blocked." };
  }
  const request = row.kit.inputs
    .filter((input) => inputs[input.id]?.trim())
    .map((input) => `${input.label}: ${inputs[input.id].trim()}`)
    .join("\n");
  const updated = await updateAssistantRecipe(
    row.recipeId,
    recipePatch(row.kit),
    profile,
  );
  if (!updated.ok) {
    return {
      ok: false as const,
      error: updated.error || "Could not update Outcome Kit.",
    };
  }
  return runAssistantRecipe(row.recipeId, request, profile, trigger);
}

export function evaluateOutcomeKitFixtures(kit: OutcomeKitDefinition): {
  ok: boolean;
  failures: string[];
} {
  const criteria = new Set(kit.criteria.map((criterion) => criterion.id));
  const artifacts = new Set(kit.artifacts.map((artifact) => artifact.kind));
  const failures: string[] = [];
  for (const fixture of kit.evalFixtures) {
    for (const criterion of fixture.expectedCriteria) {
      if (!criteria.has(criterion))
        failures.push(`${fixture.id}: missing criterion ${criterion}`);
    }
    for (const artifact of fixture.expectedArtifactKinds) {
      if (!artifacts.has(artifact))
        failures.push(`${fixture.id}: missing artifact ${artifact}`);
    }
  }
  return { ok: failures.length === 0, failures };
}
