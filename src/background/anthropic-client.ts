import type {
  AssistantMessage,
  ChatMessage,
  ChatRequest,
  ConnectionTestResult,
  ToolCall,
  ToolDefinition,
  UserContent,
} from "../shared/llm";
import { providerRequestTimeoutMs, type ProviderSettings } from "../shared/settings";
import { protocolError, ProviderHttpClient } from "./provider-http";

interface AnthropicRequestParts {
  messages: Record<string, unknown>[];
  system?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDataImage(url: string): Record<string, string> | null {
  const match = /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(url);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  return { type: "base64", media_type: match[1], data: match[2] };
}

function imageBlock(url: string): Record<string, unknown> {
  const base64 = parseDataImage(url);
  return {
    type: "image",
    source: base64 ?? { type: "url", url },
  };
}

function userContent(content: UserContent): string | Record<string, unknown>[] {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "text" ? { type: "text", text: part.text } : imageBlock(part.image_url.url),
  );
}

function toolInput(call: ToolCall): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(call.function.arguments) as unknown;
  } catch {
    throw protocolError();
  }
  if (!isRecord(value)) throw protocolError();
  return value;
}

function assistantContent(message: AssistantMessage): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  if (message.content !== null && message.content.length > 0) {
    blocks.push({ type: "text", text: message.content });
  }
  for (const call of message.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: toolInput(call),
    });
  }
  if (blocks.length === 0) throw protocolError();
  return blocks;
}

function anthropicMessage(message: ChatMessage): Record<string, unknown> | null {
  if (message.role === "system") return null;
  if (message.role === "user") return { role: "user", content: userContent(message.content) };
  if (message.role === "assistant") {
    return { role: "assistant", content: assistantContent(message) };
  }
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: message.tool_call_id, content: message.content }],
  };
}

function requestParts(messages: ChatMessage[]): AnthropicRequestParts {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const converted = messages.flatMap((message) => {
    const value = anthropicMessage(message);
    return value === null ? [] : [value];
  });
  return system.length === 0 ? { messages: converted } : { system, messages: converted };
}

function anthropicTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  };
}

function parseToolUse(value: Record<string, unknown>): ToolCall {
  if (typeof value.id !== "string" || typeof value.name !== "string" || !isRecord(value.input)) {
    throw protocolError();
  }
  return {
    id: value.id,
    type: "function",
    function: { name: value.name, arguments: JSON.stringify(value.input) },
  };
}

function parseMessageResponse(value: unknown): AssistantMessage {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) {
    throw protocolError();
  }
  const text: string[] = [];
  const toolCalls: ToolCall[] = [];
  for (const block of value.content) {
    if (!isRecord(block)) throw protocolError();
    if (block.type === "text" && typeof block.text === "string") text.push(block.text);
    if (block.type === "tool_use") toolCalls.push(parseToolUse(block));
  }
  const message: AssistantMessage = { role: "assistant", content: text.join("\n") || null };
  return toolCalls.length === 0 ? message : { ...message, tool_calls: toolCalls };
}

function parseModels(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw protocolError();
  return value.data.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [item.id];
  });
}

function anthropicHeaders(
  settings: ProviderSettings,
  contentType: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (contentType) headers["Content-Type"] = "application/json";
  if (settings.apiKey !== undefined && settings.apiKey.length > 0) {
    headers["x-api-key"] = settings.apiKey;
  }
  return headers;
}

export class AnthropicClient {
  private readonly http: ProviderHttpClient;

  constructor(
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
    private readonly timeoutOverrideMs?: number,
  ) {
    this.http = new ProviderHttpClient(fetchImpl);
  }

  async testConnection(settings: ProviderSettings): Promise<ConnectionTestResult> {
    const value = await this.http.requestJson(
      `${settings.baseUrl}/v1/models`,
      { headers: anthropicHeaders(settings, false) },
      { timeoutMs: this.timeoutMs(settings) },
    );
    const models = parseModels(value);
    return { models, selectedModelAvailable: models.includes(settings.model) };
  }

  async complete(settings: ProviderSettings, request: ChatRequest): Promise<AssistantMessage> {
    const parts = requestParts(request.messages);
    const body = {
      model: settings.model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.2,
      messages: parts.messages,
      ...(parts.system === undefined ? {} : { system: parts.system }),
      ...(request.tools === undefined ? {} : { tools: request.tools.map(anthropicTool) }),
    };
    const options = {
      timeoutMs: this.timeoutMs(settings),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    };
    const value = await this.http.requestJson(
      `${settings.baseUrl}/v1/messages`,
      { method: "POST", headers: anthropicHeaders(settings, true), body: JSON.stringify(body) },
      options,
    );
    return parseMessageResponse(value);
  }

  private timeoutMs(settings: ProviderSettings): number {
    return this.timeoutOverrideMs ?? providerRequestTimeoutMs(settings.provider);
  }
}
