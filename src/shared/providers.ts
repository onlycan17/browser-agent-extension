export const LOCAL_BASE_URL = "http://192.168.10.105:3620/v1";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const TOGETHER_BASE_URL = "https://api.together.xyz/v1";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
export const XAI_BASE_URL = "https://api.x.ai/v1";
export const DEFAULT_LOCAL_MODEL = "qwen/qwen3.8-27b";
export const LOCAL_PROVIDER_TIMEOUT_MS = 480_000;
export const OPENAI_PROVIDER_TIMEOUT_MS = 45_000;
export const CLOUD_PROVIDER_TIMEOUT_MS = 120_000;

export const PROVIDER_IDS = [
  "local",
  "openai",
  "anthropic",
  "openrouter",
  "groq",
  "together",
  "deepseek",
  "mistral",
  "xai",
  "custom",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderProtocol = "anthropic" | "openai-compatible";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  defaultModel: string;
  timeoutMs: number;
  editableBaseUrl: boolean;
  optionalHostPermission: boolean;
}

export const PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "local",
    label: "Local / LM Studio",
    protocol: "openai-compatible",
    baseUrl: LOCAL_BASE_URL,
    defaultModel: DEFAULT_LOCAL_MODEL,
    timeoutMs: LOCAL_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai-compatible",
    baseUrl: OPENAI_BASE_URL,
    defaultModel: "gpt-4.1-mini",
    timeoutMs: OPENAI_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    baseUrl: ANTHROPIC_BASE_URL,
    defaultModel: "claude-sonnet-4-5",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-compatible",
    baseUrl: OPENROUTER_BASE_URL,
    defaultModel: "anthropic/claude-sonnet-4.5",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai-compatible",
    baseUrl: GROQ_BASE_URL,
    defaultModel: "llama-3.3-70b-versatile",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "together",
    label: "Together AI",
    protocol: "openai-compatible",
    baseUrl: TOGETHER_BASE_URL,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-compatible",
    baseUrl: DEEPSEEK_BASE_URL,
    defaultModel: "deepseek-chat",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "mistral",
    label: "Mistral AI",
    protocol: "openai-compatible",
    baseUrl: MISTRAL_BASE_URL,
    defaultModel: "mistral-small-latest",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "xai",
    label: "xAI",
    protocol: "openai-compatible",
    baseUrl: XAI_BASE_URL,
    defaultModel: "grok-4-latest",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: false,
    optionalHostPermission: false,
  },
  {
    id: "custom",
    label: "Custom / OpenAI-compatible",
    protocol: "openai-compatible",
    baseUrl: "",
    defaultModel: "",
    timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    editableBaseUrl: true,
    optionalHostPermission: true,
  },
];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_IDS.some((provider) => provider === value);
}

export function getProviderDefinition(provider: ProviderId): ProviderDefinition {
  const definition = PROVIDERS.find((item) => item.id === provider);
  if (definition === undefined) throw new Error("Provider definition is missing.");
  return definition;
}
