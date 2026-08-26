import type { AssistantMessage, ChatRequest, ConnectionTestResult, ToolCall } from "../shared/llm";
import { providerRequestTimeoutMs, type ProviderSettings } from "../shared/settings";
import { protocolError, ProviderHttpClient } from "./provider-http";

export { ProviderError, type ProviderErrorCode } from "./provider-http";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function parseToolCall(value: unknown): ToolCall | null {
  if (!isRecord(value) || value.type !== "function" || typeof value.id !== "string") return null;
  if (!isRecord(value.function)) return null;
  const { name, arguments: argumentsJson } = value.function;
  if (typeof name !== "string" || typeof argumentsJson !== "string") return null;
  return { id: value.id, type: "function", function: { name, arguments: argumentsJson } };
}

function parseAssistantMessage(value: unknown): AssistantMessage {
  if (!isRecord(value) || value.role !== "assistant") throw protocolError();
  const rawContent = value.content;
  if (rawContent !== undefined && typeof rawContent !== "string" && rawContent !== null) {
    throw protocolError();
  }
  const hasContent = rawContent !== undefined;
  const content = rawContent ?? null;
  if (value.tool_calls === undefined) {
    if (!hasContent) throw protocolError();
    return { role: "assistant", content };
  }
  if (!isUnknownArray(value.tool_calls)) throw protocolError();
  const toolCalls = value.tool_calls.map(parseToolCall);
  if (toolCalls.some((call) => call === null)) throw protocolError();
  return { role: "assistant", content, tool_calls: toolCalls.filter((call) => call !== null) };
}

function parseChatResponse(value: unknown): AssistantMessage {
  if (!isRecord(value) || !isUnknownArray(value.choices)) throw protocolError();
  const first = value.choices[0];
  if (!isRecord(first)) throw protocolError();
  return parseAssistantMessage(first.message);
}

function parseModels(value: unknown): string[] {
  if (!isRecord(value) || !isUnknownArray(value.data)) throw protocolError();
  return value.data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [item.id];
  });
}

function createHeaders(
  settings: ProviderSettings,
  includeContentType: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeContentType) headers["Content-Type"] = "application/json";
  if (settings.apiKey !== undefined && settings.apiKey.length > 0) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }
  return headers;
}

export class OpenAICompatibleClient {
  private readonly http: ProviderHttpClient;

  constructor(
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly timeoutOverrideMs?: number,
  ) {
    this.http = new ProviderHttpClient(fetchImpl);
  }

  async testConnection(settings: ProviderSettings): Promise<ConnectionTestResult> {
    const headers = createHeaders(settings, false);
    const init = Object.keys(headers).length === 0 ? {} : { headers };
    const value = await this.http.requestJson(`${settings.baseUrl}/models`, init, {
      timeoutMs: this.timeoutMs(settings),
    });
    const models = parseModels(value);
    return { models, selectedModelAvailable: models.includes(settings.model) };
  }

  async complete(settings: ProviderSettings, request: ChatRequest): Promise<AssistantMessage> {
    const body = {
      model: settings.model,
      messages: request.messages,
      stream: false,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 2048,
      ...(request.reasoningEffort === undefined
        ? {}
        : { reasoning_effort: request.reasoningEffort }),
      ...(request.tools === undefined ? {} : { tools: request.tools, tool_choice: "auto" }),
    };
    const options = {
      timeoutMs: this.timeoutMs(settings),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
    const value = await this.http.requestJson(
      `${settings.baseUrl}/chat/completions`,
      { method: "POST", headers: createHeaders(settings, true), body: JSON.stringify(body) },
      options,
    );
    return parseChatResponse(value);
  }

  private timeoutMs(settings: ProviderSettings): number {
    return this.timeoutOverrideMs ?? providerRequestTimeoutMs(settings.provider);
  }
}
