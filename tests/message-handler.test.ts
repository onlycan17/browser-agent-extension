import { describe, expect, it } from "vitest";
import { createMessageHandler } from "../src/background/message-handler";
import { ProviderError } from "../src/background/openai-client";
import {
  DEFAULT_LOCAL_MODEL,
  LOCAL_BASE_URL,
  type ProviderSettings,
  withoutApiKey,
} from "../src/shared/settings";

const runtimeSettings: ProviderSettings = {
  provider: "local",
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
  apiKey: "secret",
};
const summary = { ...withoutApiKey(runtimeSettings), hasApiKey: true };

function createSettingsService() {
  return {
    loadRuntime: () => Promise.resolve(runtimeSettings),
    loadSummary: () => Promise.resolve(summary),
    save: () => Promise.resolve({ ok: true as const, value: summary }),
  };
}

const getRequest = { id: "get-1", type: "SETTINGS_GET", payload: {} };
const connectionRequest = { id: "test-1", type: "CONNECTION_TEST", payload: {} };
const analysis = {
  analyze: () =>
    Promise.resolve({
      answer: "Analysis",
      url: "https://example.com/",
      title: "Example",
      screenshotUsed: false,
    }),
};
const agent = {
  run: (runId: string) =>
    Promise.resolve({ runId, status: "completed" as const, answer: "Done", steps: 1 }),
  cancel: () => true,
  decideApproval: () => true,
};

describe("background message handler", () => {
  it("returns a settings summary without the API key", async () => {
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, analysis, agent);

    const result = await handle(getRequest);

    expect(result).toEqual({ id: "get-1", ok: true, data: summary });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("uses runtime secrets only inside the provider call", async () => {
    let received: ProviderSettings | undefined;
    const provider = {
      testConnection: (settings: ProviderSettings) => {
        received = settings;
        return Promise.resolve({ models: [DEFAULT_LOCAL_MODEL], selectedModelAvailable: true });
      },
    };
    const handle = createMessageHandler(createSettingsService(), provider, analysis, agent);

    const result = await handle(connectionRequest);

    expect(received?.apiKey).toBe("secret");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("maps provider failures into a stable error envelope", async () => {
    const provider = {
      testConnection: () =>
        Promise.reject(new ProviderError("PROVIDER_TIMEOUT", "Provider timed out.", true)),
    };
    const handle = createMessageHandler(createSettingsService(), provider, analysis, agent);

    await expect(handle(connectionRequest)).resolves.toEqual({
      id: "test-1",
      ok: false,
      error: { code: "PROVIDER_TIMEOUT", message: "Provider timed out.", retryable: true },
    });
  });

  it("rejects a stale approval decision after run cleanup", async () => {
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, analysis, {
      ...agent,
      decideApproval: () => false,
    });

    const result = await handle({
      id: "approval-late",
      type: "ACTION_APPROVAL_DECISION",
      payload: { runId: "run-finished", approvalId: "approval-expired", approved: true },
    });

    expect(result).toEqual({ id: "approval-late", ok: true, data: { accepted: false } });
  });

  it("rejects unknown messages before invoking services", async () => {
    const provider = { testConnection: () => Promise.reject(new Error("must not run")) };
    const handle = createMessageHandler(createSettingsService(), provider, analysis, agent);

    const result = await handle({ id: "bad-1", type: "UNKNOWN", payload: {} });

    expect(result).toMatchObject({ id: "bad-1", ok: false, error: { code: "INVALID_MESSAGE" } });
  });
});
