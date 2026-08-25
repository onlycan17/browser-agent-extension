import type { AssistantMessage, ChatRequest, ConnectionTestResult } from "../shared/llm";
import { getProviderDefinition } from "../shared/providers";
import type { ProviderSettings } from "../shared/settings";
import { AnthropicClient } from "./anthropic-client";
import { OpenAICompatibleClient } from "./openai-client";

export interface ProviderClient {
  testConnection: (settings: ProviderSettings) => Promise<ConnectionTestResult>;
  complete: (settings: ProviderSettings, request: ChatRequest) => Promise<AssistantMessage>;
}

export class ProviderClientRouter implements ProviderClient {
  constructor(
    private readonly openAICompatible: ProviderClient = new OpenAICompatibleClient(),
    private readonly anthropic: ProviderClient = new AnthropicClient(),
  ) {}

  testConnection(settings: ProviderSettings): Promise<ConnectionTestResult> {
    return this.client(settings).testConnection(settings);
  }

  complete(settings: ProviderSettings, request: ChatRequest): Promise<AssistantMessage> {
    return this.client(settings).complete(settings, request);
  }

  private client(settings: ProviderSettings): ProviderClient {
    const protocol = getProviderDefinition(settings.provider).protocol;
    return protocol === "anthropic" ? this.anthropic : this.openAICompatible;
  }
}
