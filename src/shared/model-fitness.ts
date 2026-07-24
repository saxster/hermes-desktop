export const MODEL_FITNESS_CONTRACT_VERSION = 1 as const;

export type ModelFitnessCapability =
  | "research"
  | "writing"
  | "reasoning"
  | "tool-use"
  | "long-context";

export interface ModelFitnessEvidence {
  contractVersion: typeof MODEL_FITNESS_CONTRACT_VERSION;
  provider: string;
  model: string;
  capabilities: ModelFitnessCapability[];
  sourceUrl: string;
  sourceLabel: string;
  verifiedAt: string;
}

export interface ModelFitnessResult {
  status: "verified" | "unverified" | "mismatch";
  provider: string;
  model: string;
  required: ModelFitnessCapability[];
  supported: ModelFitnessCapability[];
  missing: ModelFitnessCapability[];
  evidence?: ModelFitnessEvidence;
  reason: string;
}

/**
 * App-owned evidence, never inferred from a model name. Each row has an exact
 * provider/model match, an authoritative source, and a date. Custom, aliased,
 * auto-routed, and unlisted models remain explicitly unverified.
 */
export const VERIFIED_MODEL_FITNESS: ModelFitnessEvidence[] = [
  {
    contractVersion: MODEL_FITNESS_CONTRACT_VERSION,
    provider: "openai",
    model: "gpt-4.1",
    capabilities: [
      "research",
      "writing",
      "reasoning",
      "tool-use",
      "long-context",
    ],
    sourceUrl: "https://developers.openai.com/api/docs/models/gpt-4.1",
    sourceLabel: "OpenAI GPT-4.1 model documentation",
    verifiedAt: "2026-07-24",
  },
  {
    contractVersion: MODEL_FITNESS_CONTRACT_VERSION,
    provider: "anthropic",
    model: "claude-sonnet-5",
    capabilities: [
      "research",
      "writing",
      "reasoning",
      "tool-use",
      "long-context",
    ],
    sourceUrl:
      "https://platform.claude.com/docs/en/about-claude/models/overview",
    sourceLabel: "Anthropic Claude models overview",
    verifiedAt: "2026-07-24",
  },
];

export function resolveModelFitness(
  provider: string,
  model: string,
  required: ModelFitnessCapability[],
  evidence: ModelFitnessEvidence[] = VERIFIED_MODEL_FITNESS,
): ModelFitnessResult {
  const normalizedProvider = provider.trim();
  const normalizedModel = model.trim();
  const row = evidence.find(
    (candidate) =>
      candidate.provider === normalizedProvider &&
      candidate.model === normalizedModel,
  );
  if (!row) {
    return {
      status: "unverified",
      provider: normalizedProvider,
      model: normalizedModel,
      required,
      supported: [],
      missing: [...required],
      reason:
        normalizedProvider === "custom" || normalizedProvider === "auto"
          ? "Custom and auto-routed models are unverified until exact source-backed metadata is added."
          : "This exact provider and model id has no current source-backed fitness record.",
    };
  }
  const missing = required.filter(
    (capability) => !row.capabilities.includes(capability),
  );
  return {
    status: missing.length ? "mismatch" : "verified",
    provider: normalizedProvider,
    model: normalizedModel,
    required,
    supported: [...row.capabilities],
    missing,
    evidence: row,
    reason: missing.length
      ? `The verified model record is missing: ${missing.join(", ")}.`
      : `Verified against ${row.sourceLabel} on ${row.verifiedAt}.`,
  };
}
