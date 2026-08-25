import { describe, expect, it, vi } from "vitest";
import { ProviderClientRouter, type ProviderClient } from "../src/background/provider-client";
import type { ChatRequest } from "../src/shared/llm";
import { ANTHROPIC_BASE_URL, OPENROUTER_BASE_URL } from "../src/shared/settings";

function mockClient(): ProviderClient {
  const testConnection = vi.fn<ProviderClient["testConnection"]>();
  const complete = vi.fn<ProviderClient["complete"]>();
  testConnection.mockResolvedValue({ models: [], selectedModelAvailable: false });
  complete.mockResolvedValue({ role: "assistant", content: "Done" });
  return { testConnection, complete };
}

const request: ChatRequest = { messages: [{ role: "user", content: "Hello" }] };

const anthropicSettings = {
  provider: "anthropic" as const,
  baseUrl: ANTHROPIC_BASE_URL,
  model: "claude-sonnet-4-5",
  rememberApiKey: false,
  maxAgentSteps: 8,
};

const openRouterSettings = {
  provider: "openrouter" as const,
  baseUrl: OPENROUTER_BASE_URL,
  model: "anthropic/claude-sonnet-4.5",
  rememberApiKey: false,
  maxAgentSteps: 8,
};

describe("ProviderClientRouter", () => {
  it("routes native Anthropic requests to the Anthropic client", async () => {
    const openAICompatible = mockClient();
    const anthropic = mockClient();
    const router = new ProviderClientRouter(openAICompatible, anthropic);

    await router.testConnection(anthropicSettings);
    await router.complete(anthropicSettings, request);

    expect(anthropic.testConnection).toHaveBeenCalledWith(anthropicSettings);
    expect(anthropic.complete).toHaveBeenCalledWith(anthropicSettings, request);
    expect(openAICompatible.complete).not.toHaveBeenCalled();
  });

  it("routes OpenRouter and other compatible providers to the shared client", async () => {
    const openAICompatible = mockClient();
    const anthropic = mockClient();
    const router = new ProviderClientRouter(openAICompatible, anthropic);

    await router.testConnection(openRouterSettings);
    await router.complete(openRouterSettings, request);

    expect(openAICompatible.testConnection).toHaveBeenCalledWith(openRouterSettings);
    expect(openAICompatible.complete).toHaveBeenCalledWith(openRouterSettings, request);
    expect(anthropic.complete).not.toHaveBeenCalled();
  });
});
