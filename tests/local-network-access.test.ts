import { describe, expect, it, vi } from "vitest";
import {
  LocalNetworkAccessError,
  requestLocalNetworkAccess,
  runProviderRequest,
  testProviderConnection,
} from "../src/shared/provider-connection";
import { RuntimeRequestError } from "../src/shared/runtime-client";
import { DEFAULT_LOCAL_MODEL, LOCAL_BASE_URL, OPENAI_BASE_URL } from "../src/shared/settings";

const localSettings = {
  provider: "local" as const,
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
  hasApiKey: false,
};

function requestUrl(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("local provider connection", () => {
  it("probes from the document before the service-worker test", async () => {
    const events: string[] = [];
    const response = new Response("{}");
    if (response.body === null) throw new Error("Expected a response body.");
    const cancel = vi.spyOn(response.body, "cancel");
    const fetchImpl: typeof fetch = (input) => {
      events.push(`probe:${requestUrl(input)}`);
      return Promise.resolve(response);
    };

    const result = await testProviderConnection(
      localSettings,
      () => {
        events.push("worker");
        return Promise.resolve({ models: [DEFAULT_LOCAL_MODEL], selectedModelAvailable: true });
      },
      fetchImpl,
    );

    expect(events).toEqual([`probe:${LOCAL_BASE_URL}/models`, "worker"]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(result.selectedModelAvailable).toBe(true);
  });

  it("still runs the provider test when the document probe fails", async () => {
    const events: string[] = [];
    const fetchImpl: typeof fetch = () => {
      events.push("probe");
      return Promise.reject(new TypeError("Failed to fetch"));
    };

    const result = await testProviderConnection(
      localSettings,
      () => {
        events.push("worker");
        return Promise.resolve({ models: [DEFAULT_LOCAL_MODEL], selectedModelAvailable: true });
      },
      fetchImpl,
    );

    expect(events).toEqual(["probe", "worker"]);
    expect(result.selectedModelAvailable).toBe(true);
  });

  it("runs an analysis request after the document probe", async () => {
    const events: string[] = [];

    const result = await runProviderRequest(
      localSettings,
      () => {
        events.push("worker");
        return Promise.resolve({ answer: "Visible page summary" });
      },
      () => {
        events.push("probe");
        return Promise.resolve(new Response(null, { status: 204 }));
      },
    );

    expect(events).toEqual(["probe", "worker"]);
    expect(result).toEqual({ answer: "Visible page summary" });
  });

  it("adds a local-network hint to an unreachable analysis request", async () => {
    const providerError = new RuntimeRequestError(
      "PROVIDER_UNREACHABLE",
      "The model provider could not be reached.",
      true,
    );

    await expect(
      runProviderRequest(
        localSettings,
        () => Promise.reject(providerError),
        () => Promise.reject(new TypeError("Failed to fetch")),
      ),
    ).rejects.toEqual(new LocalNetworkAccessError());
  });

  it("adds a local-network hint only when both local requests are unreachable", async () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    const providerError = new RuntimeRequestError(
      "PROVIDER_UNREACHABLE",
      "The model provider could not be reached.",
      true,
    );

    await expect(
      testProviderConnection(localSettings, () => Promise.reject(providerError), fetchImpl),
    ).rejects.toEqual(new LocalNetworkAccessError());
  });

  it("preserves typed provider errors when the document probe succeeds", async () => {
    const providerError = new RuntimeRequestError(
      "PROVIDER_REJECTED",
      "The provider rejected the request.",
      false,
    );

    await expect(
      testProviderConnection(
        localSettings,
        () => Promise.reject(providerError),
        () => Promise.resolve(new Response(null, { status: 200 })),
      ),
    ).rejects.toBe(providerError);
  });

  it("does not probe the local network for OpenAI", async () => {
    let called = false;
    const fetchImpl: typeof fetch = () => {
      called = true;
      return Promise.resolve(new Response("{}"));
    };

    await testProviderConnection(
      {
        ...localSettings,
        provider: "openai",
        baseUrl: OPENAI_BASE_URL,
        model: "gpt-4.1-mini",
      },
      () => Promise.resolve({ models: ["gpt-4.1-mini"], selectedModelAvailable: true }),
      fetchImpl,
    );

    expect(called).toBe(false);
  });

  it("reports probe reachability without throwing", async () => {
    const reachable = await requestLocalNetworkAccess(localSettings, () =>
      Promise.resolve(new Response(null, { status: 204 })),
    );
    const blocked = await requestLocalNetworkAccess(localSettings, () =>
      Promise.reject(new TypeError("Failed to fetch")),
    );

    expect({ reachable, blocked }).toEqual({ reachable: true, blocked: false });
  });
});
