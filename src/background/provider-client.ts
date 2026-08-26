import type { AssistantMessage, ChatRequest, ConnectionTestResult } from "../shared/llm";
import { getProviderDefinition } from "../shared/providers";
import type { ProviderSettings } from "../shared/settings";
import { AnthropicClient } from "./anthropic-client";
import { OpenAICompatibleClient } from "./openai-client";
import { ProviderError } from "./provider-http";

export interface ProviderClient {
  testConnection: (settings: ProviderSettings) => Promise<ConnectionTestResult>;
  complete: (settings: ProviderSettings, request: ChatRequest) => Promise<AssistantMessage>;
}

export class ProviderClientRouter implements ProviderClient {
  constructor(
    private readonly openAICompatible: ProviderClient = new OpenAICompatibleClient(),
    private readonly anthropic: ProviderClient = new AnthropicClient(),
  ) {}

  async testConnection(settings: ProviderSettings): Promise<ConnectionTestResult> {
    this.requireApiKey(settings);
    return await this.client(settings).testConnection(settings);
  }

  async complete(settings: ProviderSettings, request: ChatRequest): Promise<AssistantMessage> {
    this.requireApiKey(settings);
    return await this.client(settings).complete(settings, request);
  }

  private requireApiKey(settings: ProviderSettings): void {
    const definition = getProviderDefinition(settings.provider);
    if (!definition.requiresApiKey || settings.apiKey?.trim().length) return;
    throw new ProviderError("PROVIDER_REJECTED", `${definition.label} API key is required.`, false);
  }

  private client(settings: ProviderSettings): ProviderClient {
    const protocol = getProviderDefinition(settings.provider).protocol;
    return protocol === "anthropic" ? this.anthropic : this.openAICompatible;
  }
}
