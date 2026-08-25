import {
  DEFAULT_LOCAL_MODEL,
  getProviderDefinition,
  isProviderId,
  LOCAL_BASE_URL,
  type ProviderId,
} from "./providers";

export type { ProviderId } from "./providers";
export {
  ANTHROPIC_BASE_URL,
  CLOUD_PROVIDER_TIMEOUT_MS,
  DEEPSEEK_BASE_URL,
  DEFAULT_LOCAL_MODEL,
  GROQ_BASE_URL,
  LOCAL_BASE_URL,
  LOCAL_PROVIDER_TIMEOUT_MS,
  MISTRAL_BASE_URL,
  OPENAI_BASE_URL,
  OPENAI_PROVIDER_TIMEOUT_MS,
  OPENROUTER_BASE_URL,
  TOGETHER_BASE_URL,
  XAI_BASE_URL,
} from "./providers";

export interface ProviderSettings {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  rememberApiKey: boolean;
  apiKey?: string;
}

export interface SettingsSummary extends Omit<ProviderSettings, "apiKey"> {
  hasApiKey: boolean;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const DEFAULT_SETTINGS: Readonly<ProviderSettings> = {
  provider: "local",
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
};

export function providerRequestTimeoutMs(provider: ProviderId): number {
  return getProviderDefinition(provider).timeoutMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeBaseUrl(value: string): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash) return null;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

function validateBaseUrl(provider: ProviderId, value: string): ValidationResult<string> {
  const baseUrl = normalizeBaseUrl(value);
  if (baseUrl === null) return { ok: false, error: "Base URL is invalid." };
  const definition = getProviderDefinition(provider);
  if (provider === "custom") {
    return new URL(baseUrl).protocol === "https:"
      ? { ok: true, value: baseUrl }
      : { ok: false, error: "Custom Base URL must use HTTPS." };
  }
  return baseUrl === definition.baseUrl
    ? { ok: true, value: baseUrl }
    : { ok: false, error: "Base URL is not allowed for this provider." };
}

function parseApiKey(record: Record<string, unknown>): ValidationResult<string | undefined> {
  if (!("apiKey" in record)) return { ok: true, value: undefined };
  if (typeof record.apiKey !== "string") return { ok: false, error: "API key must be text." };
  const apiKey = record.apiKey.trim();
  if (apiKey.length > 4096) return { ok: false, error: "API key is too long." };
  return { ok: true, value: apiKey };
}

function parseModel(record: Record<string, unknown>): ValidationResult<string> {
  if (typeof record.model !== "string" || record.model.trim().length === 0) {
    return { ok: false, error: "Model is required." };
  }
  const model = record.model.trim();
  return model.length > 160
    ? { ok: false, error: "Model is too long." }
    : { ok: true, value: model };
}

function buildSettings(
  record: Record<string, unknown>,
  provider: ProviderId,
  baseUrl: string,
): ValidationResult<ProviderSettings> {
  const model = parseModel(record);
  if (!model.ok) return model;
  if (typeof record.rememberApiKey !== "boolean") {
    return { ok: false, error: "Secret storage preference is invalid." };
  }
  const apiKey = parseApiKey(record);
  if (!apiKey.ok) return apiKey;
  const settings = {
    provider,
    baseUrl,
    model: model.value,
    rememberApiKey: record.rememberApiKey,
  };
  return apiKey.value === undefined
    ? { ok: true, value: settings }
    : { ok: true, value: { ...settings, apiKey: apiKey.value } };
}

export function parseProviderSettings(value: unknown): ValidationResult<ProviderSettings> {
  if (!isRecord(value)) return { ok: false, error: "Settings must be an object." };
  if (!isProviderId(value.provider)) return { ok: false, error: "Provider is invalid." };
  if (typeof value.baseUrl !== "string") return { ok: false, error: "Base URL is required." };
  const baseUrl = validateBaseUrl(value.provider, value.baseUrl);
  if (!baseUrl.ok) return baseUrl;
  return buildSettings(value, value.provider, baseUrl.value);
}

export function withoutApiKey(settings: ProviderSettings): Omit<ProviderSettings, "apiKey"> {
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    rememberApiKey: settings.rememberApiKey,
  };
}
