import { describe, expect, it } from "vitest";
import { ProviderError, ProviderHttpClient } from "../src/background/provider-http";

describe("ProviderHttpClient", () => {
  it("returns parsed JSON for successful responses", async () => {
    const client = new ProviderHttpClient(() =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    );

    await expect(
      client.requestJson(
        "https://api.example.test/v1/models",
        { method: "GET" },
        {
          timeoutMs: 1_000,
        },
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("surfaces the provider response detail in a rejection error", async () => {
    const client = new ProviderHttpClient(() =>
      Promise.resolve(
        new Response('{"error":"tools.11: minItems is not a permitted keyword"}', {
          status: 400,
        }),
      ),
    );

    const error = await client
      .requestJson(
        "https://api.example.test/v1/chat/completions",
        { method: "POST" },
        {
          timeoutMs: 1_000,
        },
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    const providerError = error as ProviderError;
    expect(providerError.code).toBe("PROVIDER_REJECTED");
    expect(providerError.retryable).toBe(false);
    expect(providerError.message).toContain("400");
    expect(providerError.message).toContain("minItems is not a permitted keyword");
  });

  it("compacts oversized provider error details", async () => {
    const client = new ProviderHttpClient(() =>
      Promise.resolve(new Response(`{"error":"${"x".repeat(600)}"}`, { status: 422 })),
    );

    const error = await client
      .requestJson(
        "https://api.example.test/v1/chat/completions",
        { method: "POST" },
        {
          timeoutMs: 1_000,
        },
      )
      .catch((caught: unknown) => caught);

    expect((error as ProviderError).message.length).toBeLessThanOrEqual(360);
  });

  it("keeps 5xx rejections retryable", async () => {
    const client = new ProviderHttpClient(() =>
      Promise.resolve(new Response("upstream failure", { status: 502 })),
    );

    const error = await client
      .requestJson(
        "https://api.example.test/v1/chat/completions",
        { method: "POST" },
        {
          timeoutMs: 1_000,
        },
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(true);
  });

  it("keeps API key rejections non-retryable", async () => {
    const client = new ProviderHttpClient(() =>
      Promise.resolve(new Response("invalid key", { status: 401 })),
    );

    const error = await client
      .requestJson(
        "https://api.example.test/v1/chat/completions",
        { method: "POST" },
        {
          timeoutMs: 1_000,
        },
      )
      .catch((caught: unknown) => caught);

    expect((error as ProviderError).message).toContain("rejected the API key");
    expect((error as ProviderError).retryable).toBe(false);
  });
});
