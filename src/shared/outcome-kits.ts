import type {
  AssistantRecipeAction,
  AssistantRecipeKind,
  AssistantRecipeReviewMode,
  AssistantRecipeScheduleCadence,
} from "./assistant-recipes";
import type {
  ActiveWorkExpectedArtifact,
  ActiveWorkTrigger,
} from "./active-work";
import type { AutonomyMode, AutonomyRiskClass } from "./autonomy-policy";
import type {
  ModelFitnessCapability,
  ModelFitnessResult,
} from "./model-fitness";

export const OUTCOME_KIT_CONTRACT_VERSION = 1 as const;

export interface OutcomeKitInput {
  id: string;
  label: string;
  required: boolean;
  description?: string;
}

export interface OutcomeKitCriterion {
  id: string;
  text: string;
}

export interface OutcomeKitConnectorRequirement {
  server: string;
  tool: string;
  required: boolean;
  purpose: string;
}

export interface OutcomeKitModelRequirement {
  capabilities: ModelFitnessCapability[];
  requireVerified: boolean;
}

export interface OutcomeKitScheduleTemplate {
  cadence: AssistantRecipeScheduleCadence;
  hour: number;
}

export interface OutcomeKitEvalFixture {
  id: string;
  input: string;
  expectedCriteria: string[];
  expectedArtifactKinds: ActiveWorkExpectedArtifact["kind"][];
}

export interface OutcomeKitDefinition {
  contractVersion: typeof OUTCOME_KIT_CONTRACT_VERSION;
  kitId: string;
  title: string;
  version: number;
  outcome: string;
  inputs: OutcomeKitInput[];
  artifacts: ActiveWorkExpectedArtifact[];
  criteria: OutcomeKitCriterion[];
  dependencies: {
    skills: string[];
    connectors: OutcomeKitConnectorRequirement[];
    model: OutcomeKitModelRequirement;
  };
  recipe: {
    name: string;
    kind: AssistantRecipeKind;
    description: string;
    job: string;
    inputs: string;
    output: string;
    allowedActions: AssistantRecipeAction[];
  };
  reviewPolicy: AssistantRecipeReviewMode;
  risk: {
    mode: AutonomyMode;
    classes: AutonomyRiskClass[];
  };
  triggerTemplates: ActiveWorkTrigger[];
  scheduleTemplate?: OutcomeKitScheduleTemplate;
  evalFixtures: OutcomeKitEvalFixture[];
  provenance: {
    publisher: string;
    sourceUrl?: string;
    sourceDate?: string;
  };
}

export type OutcomeKitReadinessStatus = "ready" | "attention" | "blocked";

export interface OutcomeKitReadinessItem {
  id: string;
  kind:
    | "content"
    | "connector"
    | "model"
    | "review"
    | "schedule"
    | "permission";
  status: OutcomeKitReadinessStatus;
  title: string;
  summary: string;
}

export interface OutcomeKitReadiness {
  kitId: string;
  status: OutcomeKitReadinessStatus;
  canActivate: boolean;
  items: OutcomeKitReadinessItem[];
  modelFitness: ModelFitnessResult;
  generatedAt: number;
}

export interface OutcomeKitInstallation {
  contractVersion: typeof OUTCOME_KIT_CONTRACT_VERSION;
  kit: OutcomeKitDefinition;
  packHash: string;
  contentInstalledAt: number;
  importedSkills: string[];
  recipeId?: string;
  activatedAt?: number;
  scheduleEnabledAt?: number;
}

export interface OutcomeKitSummary extends OutcomeKitInstallation {
  readiness: OutcomeKitReadiness;
}

export interface OutcomeKitActivationResult {
  ok: boolean;
  kit?: OutcomeKitSummary;
  recipeId?: string;
  error?: string;
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ARTIFACT_KINDS = new Set([
  "page",
  "session",
  "task",
  "file",
  "text",
  "proposal",
  "receipt",
  "transcript",
  "url",
]);
const MODES = new Set(["READ_ONLY", "INTERACTIVE", "SCOPED_AUTOMATION"]);
const RISKS = new Set([
  "READ",
  "WRITE_WORKSPACE",
  "EXEC",
  "EXTERNAL",
  "UNKNOWN",
]);
const TRIGGERS = new Set([
  "manual",
  "scheduled",
  "cron",
  "proposal",
  "external",
]);
const HIGH_RISK_ACTIONS = new Set([
  "process_files",
  "schedule_runs",
  "send_messages",
]);
const RECIPE_ACTIONS = new Set([
  "read_workspace",
  "search_web",
  "draft_content",
  "propose_changes",
  "process_files",
  "schedule_runs",
  "send_messages",
]);
const RECIPE_KINDS = new Set([
  "research-brief",
  "article-writer",
  "content-writer",
  "deck-builder",
  "meeting-debrief",
  "file-processor",
  "morning-briefing",
  "competitor-tracker",
  "custom",
]);

function stringValue(
  value: unknown,
  label: string,
  errors: string[],
  max = 500,
): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max)
    errors.push(`${label} must be 1-${max} characters`);
  return text;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rejectDuplicateIds(
  values: Array<{ id: string }>,
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id))
      errors.push(`${label} contains duplicate id ${value.id}`);
    seen.add(value.id);
  }
}

export function validateOutcomeKit(raw: unknown): {
  ok: boolean;
  errors: string[];
  kit?: OutcomeKitDefinition;
} {
  const errors: string[] = [];
  const value = objectValue(raw);
  if (value.contractVersion !== OUTCOME_KIT_CONTRACT_VERSION) {
    errors.push(`contractVersion must be ${OUTCOME_KIT_CONTRACT_VERSION}`);
  }
  for (const forbidden of [
    "grants",
    "permissions",
    "credentials",
    "configuration",
  ]) {
    if (value[forbidden] !== undefined) {
      errors.push(`${forbidden} must not be bundled with an Outcome Kit`);
    }
  }
  const kitId = stringValue(value.kitId, "kitId", errors, 64);
  if (kitId && !SAFE_ID.test(kitId))
    errors.push("kitId must be a lowercase safe id");
  const title = stringValue(value.title, "title", errors, 120);
  const outcome = stringValue(value.outcome, "outcome", errors, 1_000);
  const version = value.version;
  if (!Number.isInteger(version) || Number(version) < 1) {
    errors.push("version must be a positive integer");
  }

  const inputs: OutcomeKitInput[] = Array.isArray(value.inputs)
    ? value.inputs.slice(0, 50).map((rawInput, index) => {
        const input = objectValue(rawInput);
        return {
          id: stringValue(input.id, `inputs[${index}].id`, errors, 64),
          label: stringValue(
            input.label,
            `inputs[${index}].label`,
            errors,
            120,
          ),
          required: input.required === true,
          ...(typeof input.description === "string" && input.description.trim()
            ? { description: input.description.trim().slice(0, 500) }
            : {}),
        };
      })
    : [];
  if (Array.isArray(value.inputs) && value.inputs.length > 50)
    errors.push("inputs must contain at most 50 entries");
  if (!inputs.length) errors.push("inputs must be a non-empty array");
  inputs.forEach((_, index) => {
    const input = objectValue((value.inputs as unknown[])[index]);
    if (typeof input.required !== "boolean")
      errors.push(`inputs[${index}].required must be boolean`);
  });
  for (const input of inputs) {
    if (input.id && !SAFE_ID.test(input.id))
      errors.push(`input id ${input.id} is not safe`);
  }
  rejectDuplicateIds(inputs, "inputs", errors);

  const criteria: OutcomeKitCriterion[] = Array.isArray(value.criteria)
    ? value.criteria.slice(0, 50).map((rawCriterion, index) => {
        const criterion = objectValue(rawCriterion);
        return {
          id: stringValue(criterion.id, `criteria[${index}].id`, errors, 64),
          text: stringValue(
            criterion.text,
            `criteria[${index}].text`,
            errors,
            500,
          ),
        };
      })
    : [];
  if (Array.isArray(value.criteria) && value.criteria.length > 50)
    errors.push("criteria must contain at most 50 entries");
  if (!criteria.length) errors.push("criteria must be a non-empty array");
  for (const criterion of criteria) {
    if (criterion.id && !SAFE_ID.test(criterion.id)) {
      errors.push(`criterion id ${criterion.id} is not safe`);
    }
  }
  rejectDuplicateIds(criteria, "criteria", errors);

  const artifacts: ActiveWorkExpectedArtifact[] = Array.isArray(value.artifacts)
    ? value.artifacts.slice(0, 50).flatMap((rawArtifact, index) => {
        const artifact = objectValue(rawArtifact);
        if (!ARTIFACT_KINDS.has(String(artifact.kind))) {
          errors.push(`artifacts[${index}].kind is unsupported`);
          return [];
        }
        return [
          {
            kind: artifact.kind as ActiveWorkExpectedArtifact["kind"],
            label: stringValue(
              artifact.label,
              `artifacts[${index}].label`,
              errors,
              160,
            ),
            required: artifact.required !== false,
          },
        ];
      })
    : [];
  if (Array.isArray(value.artifacts) && value.artifacts.length > 50)
    errors.push("artifacts must contain at most 50 entries");
  if (!artifacts.length) errors.push("artifacts must be a non-empty array");
  if (Array.isArray(value.artifacts)) {
    value.artifacts.forEach((rawArtifact, index) => {
      const artifact = objectValue(rawArtifact);
      if (typeof artifact.required !== "boolean")
        errors.push(`artifacts[${index}].required must be boolean`);
    });
  }

  const dependenciesRaw = objectValue(value.dependencies);
  const modelRaw = objectValue(dependenciesRaw.model);
  const connectors: OutcomeKitConnectorRequirement[] = Array.isArray(
    dependenciesRaw.connectors,
  )
    ? dependenciesRaw.connectors.slice(0, 30).map((rawConnector, index) => {
        const connector = objectValue(rawConnector);
        return {
          server: stringValue(
            connector.server,
            `connectors[${index}].server`,
            errors,
            80,
          ),
          tool: stringValue(
            connector.tool,
            `connectors[${index}].tool`,
            errors,
            120,
          ),
          required: connector.required !== false,
          purpose: stringValue(
            connector.purpose,
            `connectors[${index}].purpose`,
            errors,
            240,
          ),
        };
      })
    : [];
  if (
    Array.isArray(dependenciesRaw.connectors) &&
    dependenciesRaw.connectors.length > 30
  ) {
    errors.push("dependencies.connectors must contain at most 30 entries");
  }
  if (Array.isArray(dependenciesRaw.connectors)) {
    dependenciesRaw.connectors.forEach((rawConnector, index) => {
      const connector = objectValue(rawConnector);
      if (typeof connector.required !== "boolean")
        errors.push(`connectors[${index}].required must be boolean`);
    });
  }
  const skills = Array.isArray(dependenciesRaw.skills)
    ? dependenciesRaw.skills
        .filter(
          (skill): skill is string =>
            typeof skill === "string" && !!skill.trim(),
        )
        .map((skill) => skill.trim())
        .slice(0, 50)
    : [];
  if (!Array.isArray(dependenciesRaw.skills)) {
    errors.push("dependencies.skills must be an array");
  } else {
    if (dependenciesRaw.skills.length > 50)
      errors.push("dependencies.skills must contain at most 50 entries");
    if (
      dependenciesRaw.skills.some(
        (skill) => typeof skill !== "string" || !skill.trim(),
      )
    ) {
      errors.push("dependencies.skills must contain only non-empty strings");
    }
  }
  const rawCapabilities = Array.isArray(modelRaw.capabilities)
    ? modelRaw.capabilities
    : [];
  if (
    rawCapabilities.some(
      (capability) =>
        ![
          "research",
          "writing",
          "reasoning",
          "tool-use",
          "long-context",
        ].includes(String(capability)),
    )
  ) {
    errors.push(
      "dependencies.model.capabilities contains an unsupported capability",
    );
  }
  const capabilities = rawCapabilities.filter(
    (capability): capability is ModelFitnessCapability =>
      ["research", "writing", "reasoning", "tool-use", "long-context"].includes(
        String(capability),
      ),
  );
  if (!capabilities.length) {
    errors.push("dependencies.model.capabilities must be a non-empty array");
  }
  if (typeof modelRaw.requireVerified !== "boolean") {
    errors.push("dependencies.model.requireVerified must be boolean");
  }

  const recipeRaw = objectValue(value.recipe);
  const recipeKind = RECIPE_KINDS.has(String(recipeRaw.kind))
    ? (recipeRaw.kind as AssistantRecipeKind)
    : "custom";
  if (!RECIPE_KINDS.has(String(recipeRaw.kind))) {
    errors.push("recipe.kind is unsupported");
  }
  const recipeName = stringValue(recipeRaw.name, "recipe.name", errors, 120);
  const recipeDescription = stringValue(
    recipeRaw.description,
    "recipe.description",
    errors,
    500,
  );
  const recipeJob = stringValue(recipeRaw.job, "recipe.job", errors, 2_000);
  const recipeInputs = stringValue(
    recipeRaw.inputs,
    "recipe.inputs",
    errors,
    2_000,
  );
  const recipeOutput = stringValue(
    recipeRaw.output,
    "recipe.output",
    errors,
    2_000,
  );
  const rawAllowedActions = Array.isArray(recipeRaw.allowedActions)
    ? recipeRaw.allowedActions
    : [];
  if (rawAllowedActions.some((action) => !RECIPE_ACTIONS.has(String(action)))) {
    errors.push("recipe.allowedActions contains an unsupported action");
  }
  const allowedActions = rawAllowedActions.filter(
    (action): action is AssistantRecipeAction =>
      RECIPE_ACTIONS.has(String(action)),
  );
  if (!allowedActions.length) {
    errors.push("recipe.allowedActions must be a non-empty array");
  }
  if (rawAllowedActions.length > RECIPE_ACTIONS.size) {
    errors.push("recipe.allowedActions contains too many entries");
  }
  if (
    value.reviewPolicy !== "auto-apply" &&
    value.reviewPolicy !== "review-first"
  ) {
    errors.push("reviewPolicy is unsupported");
  }
  const reviewPolicy =
    value.reviewPolicy === "auto-apply" ? "auto-apply" : "review-first";
  const riskRaw = objectValue(value.risk);
  const mode = MODES.has(String(riskRaw.mode))
    ? (riskRaw.mode as AutonomyMode)
    : "INTERACTIVE";
  if (!MODES.has(String(riskRaw.mode))) errors.push("risk.mode is unsupported");
  const rawRiskClasses = Array.isArray(riskRaw.classes) ? riskRaw.classes : [];
  if (rawRiskClasses.some((risk) => !RISKS.has(String(risk)))) {
    errors.push("risk.classes contains an unsupported risk class");
  }
  const classes = rawRiskClasses.length
    ? rawRiskClasses.filter((risk): risk is AutonomyRiskClass =>
        RISKS.has(String(risk)),
      )
    : [];
  if (!classes.length) errors.push("risk.classes must be a non-empty array");
  const highRisk =
    classes.some((risk) => risk !== "READ") ||
    allowedActions.some((action) => HIGH_RISK_ACTIONS.has(action));
  if (highRisk && reviewPolicy !== "review-first") {
    errors.push("high-risk Outcome Kits must use review-first");
  }

  const rawTriggers = Array.isArray(value.triggerTemplates)
    ? value.triggerTemplates
    : [];
  if (!rawTriggers.length)
    errors.push("triggerTemplates must be a non-empty array");
  if (rawTriggers.some((trigger) => !TRIGGERS.has(String(trigger)))) {
    errors.push("triggerTemplates contains an unsupported trigger");
  }
  const triggerTemplates = rawTriggers.filter(
    (trigger): trigger is ActiveWorkTrigger => TRIGGERS.has(String(trigger)),
  );
  if (new Set(triggerTemplates).size !== triggerTemplates.length) {
    errors.push("triggerTemplates must not contain duplicates");
  }
  if (
    triggerTemplates.some((trigger) => trigger !== "manual") &&
    reviewPolicy !== "review-first"
  ) {
    errors.push(
      "scheduled, proposal, and external triggers must be review-first",
    );
  }

  const scheduleRaw =
    value.scheduleTemplate === undefined
      ? undefined
      : objectValue(value.scheduleTemplate);
  const scheduleTemplate = scheduleRaw
    ? {
        cadence: (["daily", "weekly", "monthly"].includes(
          String(scheduleRaw.cadence),
        )
          ? scheduleRaw.cadence
          : "daily") as AssistantRecipeScheduleCadence,
        hour:
          Number.isInteger(scheduleRaw.hour) &&
          Number(scheduleRaw.hour) >= 0 &&
          Number(scheduleRaw.hour) <= 23
            ? Number(scheduleRaw.hour)
            : 9,
      }
    : undefined;
  if (
    scheduleRaw &&
    !["daily", "weekly", "monthly"].includes(String(scheduleRaw.cadence))
  ) {
    errors.push("scheduleTemplate.cadence is unsupported");
  }
  if (
    scheduleRaw &&
    (!Number.isInteger(scheduleRaw.hour) ||
      Number(scheduleRaw.hour) < 0 ||
      Number(scheduleRaw.hour) > 23)
  ) {
    errors.push("scheduleTemplate.hour must be an integer from 0 to 23");
  }
  if (
    scheduleTemplate &&
    !triggerTemplates.some(
      (trigger) => trigger === "scheduled" || trigger === "cron",
    )
  ) {
    errors.push("scheduleTemplate requires a scheduled or cron trigger");
  }
  if (
    reviewPolicy === "auto-apply" &&
    artifacts.some((artifact) => artifact.required && artifact.kind !== "text")
  ) {
    errors.push("auto-apply Outcome Kits may only require text artifacts");
  }

  const provenanceRaw = objectValue(value.provenance);
  const provenance = {
    publisher: stringValue(
      provenanceRaw.publisher,
      "provenance.publisher",
      errors,
      160,
    ),
    ...(typeof provenanceRaw.sourceUrl === "string" &&
    provenanceRaw.sourceUrl.trim()
      ? { sourceUrl: provenanceRaw.sourceUrl.trim().slice(0, 500) }
      : {}),
    ...(typeof provenanceRaw.sourceDate === "string" &&
    provenanceRaw.sourceDate.trim()
      ? { sourceDate: provenanceRaw.sourceDate.trim().slice(0, 40) }
      : {}),
  };
  if (provenance.sourceUrl) {
    const safeRelative =
      !provenance.sourceUrl.startsWith("/") &&
      !provenance.sourceUrl.split("/").includes("..") &&
      /^[A-Za-z0-9_.\-/]+$/.test(provenance.sourceUrl);
    if (!safeRelative) {
      try {
        const url = new URL(provenance.sourceUrl);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          errors.push(
            "provenance.sourceUrl must be an http(s) URL or safe relative path",
          );
        }
      } catch {
        errors.push(
          "provenance.sourceUrl must be an http(s) URL or safe relative path",
        );
      }
    }
  }
  if (
    provenance.sourceDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(provenance.sourceDate)
  ) {
    errors.push("provenance.sourceDate must use YYYY-MM-DD");
  }

  const evalFixtures: OutcomeKitEvalFixture[] = Array.isArray(
    value.evalFixtures,
  )
    ? value.evalFixtures.slice(0, 20).map((rawFixture, index) => {
        const fixture = objectValue(rawFixture);
        return {
          id: stringValue(fixture.id, `evalFixtures[${index}].id`, errors, 64),
          input: stringValue(
            fixture.input,
            `evalFixtures[${index}].input`,
            errors,
            5_000,
          ),
          expectedCriteria: Array.isArray(fixture.expectedCriteria)
            ? fixture.expectedCriteria
                .filter((item): item is string => typeof item === "string")
                .slice(0, 50)
            : [],
          expectedArtifactKinds: Array.isArray(fixture.expectedArtifactKinds)
            ? fixture.expectedArtifactKinds
                .filter((kind): kind is ActiveWorkExpectedArtifact["kind"] =>
                  ARTIFACT_KINDS.has(String(kind)),
                )
                .slice(0, 50)
            : [],
        };
      })
    : [];
  if (Array.isArray(value.evalFixtures) && value.evalFixtures.length > 20) {
    errors.push("evalFixtures must contain at most 20 entries");
  }
  if (Array.isArray(value.evalFixtures)) {
    value.evalFixtures.forEach((rawFixture, index) => {
      const fixture = objectValue(rawFixture);
      if (!Array.isArray(fixture.expectedCriteria)) {
        errors.push(`evalFixtures[${index}].expectedCriteria must be an array`);
      } else {
        if (fixture.expectedCriteria.length > 50)
          errors.push(
            `evalFixtures[${index}].expectedCriteria must contain at most 50 entries`,
          );
        if (fixture.expectedCriteria.some((item) => typeof item !== "string"))
          errors.push(
            `evalFixtures[${index}].expectedCriteria must contain only strings`,
          );
      }
      if (!Array.isArray(fixture.expectedArtifactKinds)) {
        errors.push(
          `evalFixtures[${index}].expectedArtifactKinds must be an array`,
        );
      } else {
        if (fixture.expectedArtifactKinds.length > 50)
          errors.push(
            `evalFixtures[${index}].expectedArtifactKinds must contain at most 50 entries`,
          );
        if (
          fixture.expectedArtifactKinds.some(
            (kind) => !ARTIFACT_KINDS.has(String(kind)),
          )
        ) {
          errors.push(
            `evalFixtures[${index}].expectedArtifactKinds contains an unsupported kind`,
          );
        }
      }
    });
  }
  if (!evalFixtures.length)
    errors.push("evalFixtures must be a non-empty array");
  rejectDuplicateIds(evalFixtures, "evalFixtures", errors);
  const criterionIds = new Set(criteria.map((criterion) => criterion.id));
  const artifactKinds = new Set(artifacts.map((artifact) => artifact.kind));
  for (const fixture of evalFixtures) {
    for (const criterionId of fixture.expectedCriteria) {
      if (!criterionIds.has(criterionId)) {
        errors.push(
          `eval fixture ${fixture.id} references unknown criterion ${criterionId}`,
        );
      }
    }
    for (const artifactKind of fixture.expectedArtifactKinds) {
      if (!artifactKinds.has(artifactKind)) {
        errors.push(
          `eval fixture ${fixture.id} references undeclared artifact ${artifactKind}`,
        );
      }
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    kit: {
      contractVersion: OUTCOME_KIT_CONTRACT_VERSION,
      kitId,
      title,
      version: version as number,
      outcome,
      inputs,
      artifacts,
      criteria,
      dependencies: {
        skills,
        connectors,
        model: {
          capabilities,
          requireVerified: modelRaw.requireVerified !== false,
        },
      },
      recipe: {
        name: recipeName,
        kind: recipeKind,
        description: recipeDescription,
        job: recipeJob,
        inputs: recipeInputs,
        output: recipeOutput,
        allowedActions,
      },
      reviewPolicy,
      risk: { mode, classes },
      triggerTemplates,
      scheduleTemplate,
      evalFixtures,
      provenance,
    },
  };
}
