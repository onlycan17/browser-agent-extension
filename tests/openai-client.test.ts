import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleClient, ProviderError } from "../src/background/openai-client";
import { createVisionContent, type ToolDefinition } from "../src/shared/llm";
import {
  DEFAULT_LOCAL_MODEL,
  LOCAL_BASE_URL,
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
} from "../src/shared/settings";

const localSettings = {
  provider: "local" as const,
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
  maxAgentSteps: 8,
};

interface CapturedRequest {
  input: string | URL | Request;
  init: RequestInit | undefined;
}

function mockFetch(response: Response, capture?: CapturedRequest[]): typeof fetch {
  return (input, init) => {
    capture?.push({ input, init });
    return Promise.resolve(response);
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function readBody(request: CapturedRequest | undefined): unknown {
  const body = request?.init?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON string request body.");
  return JSON.parse(body) as unknown;
}

function stalledJsonResponse(
  signal: AbortSignal | null | undefined,
  started: () => void,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      started();
      signal?.addEventListener("abort", () => {
        controller.error(signal.reason);
      });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/json" } });
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

describe("OpenAICompatibleClient", () => {
  it("binds the native fetch receiver to the global scope", async () => {
    let receiverIsGlobal = false;
    const fetchImpl: typeof fetch = function (this: unknown) {
      receiverIsGlobal = this === globalThis;
      return Promise.resolve(jsonResponse({ data: [{ id: DEFAULT_LOCAL_MODEL }] }));
    };
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const client = new OpenAICompatibleClient();

      await client.testConnection(localSettings);

      expect(receiverIsGlobal).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lists models without preflight-triggering headers", async () => {
    const requests: CapturedRequest[] = [];
    const fetchImpl = mockFetch(jsonResponse({ data: [{ id: DEFAULT_LOCAL_MODEL }] }), requests);
    const client = new OpenAICompatibleClient(fetchImpl);

    await expect(client.testConnection(localSettings)).resolves.toEqual({
      models: [DEFAULT_LOCAL_MODEL],
      selectedModelAvailable: true,
    });
    expect(requests[0]?.init?.headers).toBeUndefined();
  });

  it("adds authorization only when an API key exists", async () => {
    const requests: CapturedRequest[] = [];
    const fetchImpl = mockFetch(jsonResponse({ data: [] }), requests);
    const client = new OpenAICompatibleClient(fetchImpl);

    await client.testConnection({
      ...localSettings,
      provider: "openai",
      baseUrl: OPENAI_BASE_URL,
      model: "gpt-4.1-mini",
      apiKey: "secret-key",
    });

    expect(requests[0]?.init?.headers).toEqual({ Authorization: "Bearer secret-key" });
  });

  it("uses OpenRouter through the compatible models endpoint", async () => {
    const requests: CapturedRequest[] = [];
    const client = new OpenAICompatibleClient(
      mockFetch(jsonResponse({ data: [{ id: "anthropic/claude-sonnet-4.5" }] }), requests),
    );

    await expect(
      client.testConnection({
        ...localSettings,
        provider: "openrouter",
        baseUrl: OPENROUTER_BASE_URL,
        model: "anthropic/claude-sonnet-4.5",
        apiKey: "openrouter-key",
      }),
    ).resolves.toMatchObject({ selectedModelAvailable: true });

    expect(requests[0]?.input).toBe("https://openrouter.ai/api/v1/models");
    expect(requests[0]?.init?.headers).toEqual({ Authorization: "Bearer openrouter-key" });
  });

  it("uses the registered Custom base URL without changing its path", async () => {
    const requests: CapturedRequest[] = [];
    const client = new OpenAICompatibleClient(
      mockFetch(
        jsonResponse({ choices: [{ message: { role: "assistant", content: "Custom works" } }] }),
        requests,
      ),
    );

    await client.complete(
      {
        ...localSettings,
        provider: "custom",
        baseUrl: "https://llm.example.com/openai/v1",
        model: "example-model",
      },
      { messages: [{ role: "user", content: "Hello" }] },
    );

    expect(requests[0]?.input).toBe("https://llm.example.com/openai/v1/chat/completions");
  });

  it("sends image content and parses tool calls", async () => {
    const requests: CapturedRequest[] = [];
    const response = jsonResponse({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: { name: "click_element", arguments: '{"elementId":"e-1"}' },
              },
            ],
          },
        },
      ],
    });
    const client = new OpenAICompatibleClient(mockFetch(response, requests));

    const result = await client.complete(localSettings, {
      messages: [
        {
          role: "user",
          content: createVisionContent("Describe the page", "data:image/png;base64,abc"),
        },
      ],
      tools: [clickTool],
    });

    const body = readBody(requests[0]);
    expect(requests[0]?.init?.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(body).toMatchObject({
      model: DEFAULT_LOCAL_MODEL,
      tools: [clickTool],
      tool_choice: "auto",
      messages: [
        {
          content: [
            { type: "text", text: "Describe the page" },
            { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
          ],
        },
      ],
    });
    expect(result.tool_calls?.[0]?.function.name).toBe("click_element");
  });

  it("maps authentication responses without exposing response bodies", async () => {
    const client = new OpenAICompatibleClient(mockFetch(jsonResponse({ secret: "leak" }, 401)));

    const request = client.testConnection(localSettings);

    await expect(request).rejects.toMatchObject({ code: "PROVIDER_REJECTED", retryable: false });
    await expect(request).rejects.not.toThrow("leak");
  });

  it.each(["models", "completion"] as const)(
    "maps non-JSON %s responses to protocol errors",
    async (requestType) => {
      const client = new OpenAICompatibleClient(mockFetch(new Response("not-json")));
      const request =
        requestType === "models"
          ? client.testConnection(localSettings)
          : client.complete(localSettings, { messages: [] });

      await expect(request).rejects.toMatchObject({
        code: "MODEL_PROTOCOL_ERROR",
        retryable: false,
      });
    },
  );

  it("rejects malformed assistant messages", async () => {
    const client = new OpenAICompatibleClient(mockFetch(jsonResponse({ choices: [] })));

    await expect(client.complete(localSettings, { messages: [] })).rejects.toMatchObject({
      code: "MODEL_PROTOCOL_ERROR",
    });
  });

  it("does not start fetch for an already-aborted request", async () => {
    let called = false;
    const fetchImpl: typeof fetch = () => {
      called = true;
      return Promise.resolve(jsonResponse({ choices: [] }));
    };
    const controller = new AbortController();
    controller.abort();
    const client = new OpenAICompatibleClient(fetchImpl);

    await expect(
      client.complete(localSettings, { messages: [], signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });

  it("propagates caller cancellation during an in-flight request", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        markStarted?.();
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const controller = new AbortController();
    const client = new OpenAICompatibleClient(fetchImpl);
    const request = client.complete(localSettings, { messages: [], signal: controller.signal });
    await started;

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves caller cancellation while reading a response body", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchImpl: typeof fetch = (_input, init) =>
      Promise.resolve(stalledJsonResponse(init?.signal, () => markStarted?.()));
    const controller = new AbortController();
    const client = new OpenAICompatibleClient(fetchImpl);
    const request = client.complete(localSettings, { messages: [], signal: controller.signal });
    await started;

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("preserves timeout classification while reading a response body", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      Promise.resolve(stalledJsonResponse(init?.signal, () => undefined));
    const client = new OpenAICompatibleClient(fetchImpl, 5);

    await expect(client.testConnection(localSettings)).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
      retryable: true,
    });
  });

  it("cleans up timers and caller abort listeners after success", async () => {
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");
    const client = new OpenAICompatibleClient(
      mockFetch(jsonResponse({ choices: [{ message: { role: "assistant", content: "Done" } }] })),
    );
    try {
      await client.complete(localSettings, { messages: [], signal: controller.signal });

      expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(clearTimer).toHaveBeenCalled();
    } finally {
      removeListener.mockRestore();
      clearTimer.mockRestore();
    }
  });

  it("times out stalled requests", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const client = new OpenAICompatibleClient(fetchImpl, 5);

    await expect(client.testConnection(localSettings)).rejects.toEqual(
      new ProviderError("PROVIDER_TIMEOUT", "The provider request timed out.", true),
    );
  });
});
