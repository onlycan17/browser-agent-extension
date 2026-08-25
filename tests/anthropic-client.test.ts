import { describe, expect, it } from "vitest";
import { AnthropicClient } from "../src/background/anthropic-client";
import { createVisionContent, type ToolDefinition } from "../src/shared/llm";
import { ANTHROPIC_BASE_URL } from "../src/shared/settings";

const anthropicSettings = {
  provider: "anthropic" as const,
  baseUrl: ANTHROPIC_BASE_URL,
  model: "claude-sonnet-4-5",
  apiKey: "anthropic-secret",
  rememberApiKey: false,
};

interface CapturedRequest {
  input: string | URL | Request;
  init: RequestInit | undefined;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(response: Response, capture: CapturedRequest[]): typeof fetch {
  return (input, init) => {
    capture.push({ input, init });
    return Promise.resolve(response);
  };
}

function readBody(request: CapturedRequest | undefined): Record<string, unknown> {
  const body = request?.init?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON string request body.");
  const value = JSON.parse(body) as unknown;
  if (typeof value !== "object" || value === null) throw new Error("Expected an object body.");
  return value as Record<string, unknown>;
}

const clickTool: ToolDefinition = {
  type: "function",
  function: {
    name: "click_element",
    description: "Clicks an observed element",
    parameters: {
      type: "object",
      properties: { elementId: { type: "string" } },
      required: ["elementId"],
      additionalProperties: false,
    },
  },
};

describe("AnthropicClient", () => {
  it("lists models with Anthropic browser-safe headers", async () => {
    const requests: CapturedRequest[] = [];
    const client = new AnthropicClient(
      mockFetch(jsonResponse({ data: [{ id: "claude-sonnet-4-5" }] }), requests),
    );

    await expect(client.testConnection(anthropicSettings)).resolves.toEqual({
      models: ["claude-sonnet-4-5"],
      selectedModelAvailable: true,
    });
    expect(requests[0]?.input).toBe("https://api.anthropic.com/v1/models");
    expect(requests[0]?.init?.headers).toEqual({
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      "x-api-key": "anthropic-secret",
    });
  });

  it("translates system, image, and tool definitions to Messages API", async () => {
    const requests: CapturedRequest[] = [];
    const client = new AnthropicClient(
      mockFetch(
        jsonResponse({
          role: "assistant",
          content: [
            { type: "text", text: "I will click it." },
            { type: "tool_use", id: "tool-1", name: "click_element", input: { elementId: "e-1" } },
          ],
        }),
        requests,
      ),
    );

    const result = await client.complete(anthropicSettings, {
      messages: [
        { role: "system", content: "Stay safe." },
        {
          role: "user",
          content: createVisionContent("Describe", "data:image/png;base64,YWJj"),
        },
      ],
      tools: [clickTool],
      maxTokens: 900,
      temperature: 0.1,
    });

    expect(requests[0]?.input).toBe("https://api.anthropic.com/v1/messages");
    expect(requests[0]?.init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-api-key": "anthropic-secret",
    });
    expect(readBody(requests[0])).toMatchObject({
      model: "claude-sonnet-4-5",
      max_tokens: 900,
      temperature: 0.1,
      system: "Stay safe.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "YWJj" },
            },
          ],
        },
      ],
      tools: [
        {
          name: "click_element",
          description: "Clicks an observed element",
          input_schema: clickTool.function.parameters,
        },
      ],
    });
    expect(result).toEqual({
      role: "assistant",
      content: "I will click it.",
      tool_calls: [
        {
          id: "tool-1",
          type: "function",
          function: { name: "click_element", arguments: '{"elementId":"e-1"}' },
        },
      ],
    });
  });

  it("translates assistant tool calls and tool results in history", async () => {
    const requests: CapturedRequest[] = [];
    const client = new AnthropicClient(
      mockFetch(
        jsonResponse({ role: "assistant", content: [{ type: "text", text: "Done" }] }),
        requests,
      ),
    );

    await client.complete(anthropicSettings, {
      messages: [
        { role: "user", content: "Click" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "tool-1",
              type: "function",
              function: { name: "click_element", arguments: '{"elementId":"e-1"}' },
            },
          ],
        },
        { role: "tool", tool_call_id: "tool-1", content: '{"ok":true}' },
      ],
    });

    expect(readBody(requests[0]).messages).toEqual([
      { role: "user", content: "Click" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "tool-1", name: "click_element", input: { elementId: "e-1" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: '{"ok":true}' }],
      },
    ]);
  });

  it.each(["models", "messages"] as const)(
    "maps non-JSON %s responses to protocol errors",
    async (requestType) => {
      const client = new AnthropicClient(() => Promise.resolve(new Response("not-json")));
      const request =
        requestType === "models"
          ? client.testConnection(anthropicSettings)
          : client.complete(anthropicSettings, { messages: [] });

      await expect(request).rejects.toMatchObject({
        code: "MODEL_PROTOCOL_ERROR",
        retryable: false,
      });
    },
  );

  it("rejects malformed tool responses", async () => {
    const client = new AnthropicClient(() =>
      Promise.resolve(
        jsonResponse({
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "click_element", input: "bad" }],
        }),
      ),
    );

    await expect(client.complete(anthropicSettings, { messages: [] })).rejects.toMatchObject({
      code: "MODEL_PROTOCOL_ERROR",
    });
  });

  it("does not start an Anthropic request after caller cancellation", async () => {
    let called = false;
    const client = new AnthropicClient(() => {
      called = true;
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.complete(anthropicSettings, { messages: [], signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });

  it("times out a stalled Anthropic request", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const client = new AnthropicClient(fetchImpl, 5);

    await expect(client.testConnection(anthropicSettings)).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  it("does not expose Anthropic authentication response bodies", async () => {
    const client = new AnthropicClient(() =>
      Promise.resolve(jsonResponse({ error: { message: "secret details" } }, 401)),
    );

    const request = client.testConnection(anthropicSettings);

    await expect(request).rejects.toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
    await expect(request).rejects.not.toThrow("secret details");
  });
});
