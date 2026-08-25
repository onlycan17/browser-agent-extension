import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_BASE_URL,
  CLOUD_PROVIDER_TIMEOUT_MS,
  DEFAULT_LOCAL_MODEL,
  LOCAL_BASE_URL,
  LOCAL_PROVIDER_TIMEOUT_MS,
  OPENAI_BASE_URL,
  OPENAI_PROVIDER_TIMEOUT_MS,
  OPENROUTER_BASE_URL,
  parseProviderSettings,
  providerRequestTimeoutMs,
} from "../src/shared/settings";

const validLocalSettings = {
  provider: "local",
  baseUrl: `${LOCAL_BASE_URL}/`,
  model: ` ${DEFAULT_LOCAL_MODEL} `,
  rememberApiKey: false,
};

describe("provider settings", () => {
  it("uses bounded provider-specific timeouts", () => {
    expect(providerRequestTimeoutMs("local")).toBe(LOCAL_PROVIDER_TIMEOUT_MS);
    expect(LOCAL_PROVIDER_TIMEOUT_MS).toBe(480_000);
    expect(providerRequestTimeoutMs("openai")).toBe(OPENAI_PROVIDER_TIMEOUT_MS);
    expect(providerRequestTimeoutMs("anthropic")).toBe(CLOUD_PROVIDER_TIMEOUT_MS);
    expect(providerRequestTimeoutMs("openrouter")).toBe(CLOUD_PROVIDER_TIMEOUT_MS);
    expect(providerRequestTimeoutMs("custom")).toBe(CLOUD_PROVIDER_TIMEOUT_MS);
  });

  it("normalizes the allowed local URL and model", () => {
    expect(parseProviderSettings(validLocalSettings)).toEqual({
      ok: true,
      value: {
        provider: "local",
        baseUrl: LOCAL_BASE_URL,
        model: DEFAULT_LOCAL_MODEL,
        rememberApiKey: false,
      },
    });
  });

  it.each([
    ["openai", OPENAI_BASE_URL, "gpt-4.1-mini"],
    ["anthropic", ANTHROPIC_BASE_URL, "claude-sonnet-4-5"],
    ["openrouter", OPENROUTER_BASE_URL, "anthropic/claude-sonnet-4.5"],
  ] as const)("accepts the fixed %s origin", (provider, baseUrl, model) => {
    const result = parseProviderSettings({
      provider,
      baseUrl,
      model,
      apiKey: " secret-key ",
      rememberApiKey: true,
    });

    expect(result).toMatchObject({ ok: true, value: { provider, baseUrl, apiKey: "secret-key" } });
  });

  it("accepts and normalizes an HTTPS custom endpoint", () => {
    const result = parseProviderSettings({
      provider: "custom",
      baseUrl: "https://llm.example.com/openai/v1/",
      model: "example-model",
      rememberApiKey: false,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { provider: "custom", baseUrl: "https://llm.example.com/openai/v1" },
    });
  });

  it("ignores the legacy maxAgentSteps field", () => {
    const result = parseProviderSettings({ ...validLocalSettings, maxAgentSteps: 12 });

    expect(result).toMatchObject({ ok: true, value: { provider: "local" } });
    if (result.ok) expect(result.value).not.toHaveProperty("maxAgentSteps");
  });

  it.each([
    [{ ...validLocalSettings, provider: "unknown" }, "Provider is invalid."],
    [{ ...validLocalSettings, baseUrl: OPENAI_BASE_URL }, "Base URL is not allowed"],
    [{ ...validLocalSettings, model: " " }, "Model is required."],
    [
      {
        ...validLocalSettings,
        provider: "custom",
        baseUrl: "http://llm.example.com/v1",
      },
      "must use HTTPS",
    ],
    [
      {
        ...validLocalSettings,
        provider: "custom",
        baseUrl: "https://user:password@llm.example.com/v1",
      },
      "Base URL is invalid",
    ],
  ])("rejects invalid settings %#", (value, message) => {
    const result = parseProviderSettings(value);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });
});
