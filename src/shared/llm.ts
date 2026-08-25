export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

export type UserContent = string | (TextContentPart | ImageContentPart)[];

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: UserContent;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export interface ConnectionTestResult {
  models: string[];
  selectedModelAvailable: boolean;
}

export function createVisionContent(prompt: string, dataUrl: string): UserContent {
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: dataUrl } },
  ];
}
