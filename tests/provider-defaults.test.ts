import { describe, expect, it } from "vitest";
import { getProviderDefaults } from "../src/settings/provider-defaults";
import {
  ANTHROPIC_BASE_URL,
  DEEPSEEK_BASE_URL,
  GROQ_BASE_URL,
  LOCAL_BASE_URL,
  MISTRAL_BASE_URL,
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  TOGETHER_BASE_URL,
  XAI_BASE_URL,
} from "../src/shared/settings";

describe("provider UI defaults", () => {
  it.each([
    ["local", LOCAL_BASE_URL, "qwen/qwen3.8-27b"],
    ["openai", OPENAI_BASE_URL, "gpt-4.1-mini"],
    ["anthropic", ANTHROPIC_BASE_URL, "claude-sonnet-4-5"],
    ["openrouter", OPENROUTER_BASE_URL, "anthropic/claude-sonnet-4.5"],
    ["groq", GROQ_BASE_URL, "llama-3.3-70b-versatile"],
    ["together", TOGETHER_BASE_URL, "meta-llama/Llama-3.3-70B-Instruct-Turbo"],
    ["deepseek", DEEPSEEK_BASE_URL, "deepseek-chat"],
    ["mistral", MISTRAL_BASE_URL, "mistral-small-latest"],
    ["xai", XAI_BASE_URL, "grok-4-latest"],
  ] as const)("provides fixed defaults for %s", (provider, baseUrl, model) => {
    expect(getProviderDefaults(provider)).toEqual({ baseUrl, model });
  });

  it("leaves custom provider values for the user to register", () => {
    expect(getProviderDefaults("custom")).toEqual({ baseUrl: "", model: "" });
  });
});
