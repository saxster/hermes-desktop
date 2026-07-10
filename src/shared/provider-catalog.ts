export interface ProviderCatalogEntry {
  id: string;
  label: string;
  baseUrl?: string;
  envKey?: string;
}

/**
 * Built-in inference providers in renderer display order. Provider ids must
 * match Hermes Agent's provider registry; aliases are resolved separately.
 */
export const PROVIDER_CATALOG: ReadonlyArray<ProviderCatalogEntry> = [
  { id: "auto", label: "constants.autoDetect" },
  {
    id: "openrouter",
    label: "constants.openrouterName",
    baseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
  },
  {
    id: "anthropic",
    label: "constants.anthropicName",
    baseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai",
    label: "constants.openaiName",
    baseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
  },
  { id: "openai-codex", label: "constants.openaiCodexName" },
  { id: "google", label: "constants.googleName", envKey: "GOOGLE_API_KEY" },
  {
    id: "xai",
    label: "constants.xaiName",
    baseUrl: "https://api.x.ai/v1",
    envKey: "XAI_API_KEY",
  },
  {
    id: "mistral",
    label: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    envKey: "MISTRAL_API_KEY",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    envKey: "DEEPSEEK_API_KEY",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
  },
  {
    id: "together",
    label: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    envKey: "TOGETHER_API_KEY",
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    envKey: "FIREWORKS_API_KEY",
  },
  {
    id: "cerebras",
    label: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    envKey: "CEREBRAS_API_KEY",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    envKey: "PERPLEXITY_API_KEY",
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    envKey: "HF_TOKEN",
  },
  { id: "nvidia", label: "NVIDIA NIM", envKey: "NVIDIA_API_KEY" },
  {
    id: "zai",
    label: "Z.ai / GLM",
    baseUrl: "https://api.z.ai/api/paas/v4",
    envKey: "GLM_API_KEY",
  },
  { id: "qwen", label: "Qwen", envKey: "QWEN_API_KEY" },
  { id: "minimax", label: "MiniMax", envKey: "MINIMAX_API_KEY" },
  { id: "nous", label: "constants.nousName", envKey: "NOUS_API_KEY" },
  {
    id: "xai-oauth",
    label: "xAI Grok (OAuth)",
    baseUrl: "https://api.x.ai/v1",
  },
  {
    id: "qwen-oauth",
    label: "Qwen (OAuth)",
    baseUrl: "https://portal.qwen.ai/v1",
  },
  { id: "google-gemini-cli", label: "Gemini (CLI OAuth)" },
  { id: "minimax-oauth", label: "MiniMax (OAuth)" },
  {
    id: "kimi-coding",
    label: "Kimi (Coding Plan)",
    baseUrl: "https://api.moonshot.ai/v1",
    envKey: "KIMI_API_KEY",
  },
  { id: "custom", label: "constants.customOpenAICompatibleName" },
];

const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  glm: "zai",
  hf: "huggingface",
  kimi: "kimi-coding",
  "nous-api": "nous",
};

const CATALOG_BY_ID = new Map(
  PROVIDER_CATALOG.map((provider) => [provider.id, provider]),
);

export const PROVIDER_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = PROVIDER_CATALOG.map(({ id, label }) => ({ value: id, label }));

export const PROVIDER_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(
    PROVIDER_CATALOG.map(({ id, label }) => [
      id,
      id === "custom" ? "OpenAI Compatible / Local" : label,
    ]),
  );

export const PROVIDER_BASE_URLS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    PROVIDER_CATALOG.filter((provider) => provider.baseUrl).map((provider) => [
      provider.id,
      provider.baseUrl as string,
    ]),
  ),
  glm: "https://api.z.ai/api/paas/v4",
};

function canonicalProviderId(provider: string): string {
  const id = provider.trim().toLowerCase();
  return PROVIDER_ALIASES[id] ?? id;
}

export function providerEnvKey(provider: string): string | null {
  return CATALOG_BY_ID.get(canonicalProviderId(provider))?.envKey ?? null;
}

export function canonicalProviderBaseUrl(provider: string): string | null {
  return CATALOG_BY_ID.get(canonicalProviderId(provider))?.baseUrl ?? null;
}
