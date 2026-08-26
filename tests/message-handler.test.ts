import { describe, expect, it, vi } from "vitest";
import { createMessageHandler } from "../src/background/message-handler";
import type { AgentEvent, AgentRunResult } from "../src/shared/agent";
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
const agent = {
  run: (runId: string) =>
    Promise.resolve({ runId, status: "completed" as const, answer: "Done", steps: 1 }),
  isRunning: () => false,
  cancel: () => true,
  decideApproval: () => true,
};

describe("background message handler", () => {
  it("returns a settings summary without the API key", async () => {
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, agent);

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
    const handle = createMessageHandler(createSettingsService(), provider, agent);

    const result = await handle(connectionRequest);

    expect(received?.apiKey).toBe("secret");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("maps provider failures into a stable error envelope", async () => {
    const provider = {
      testConnection: () =>
        Promise.reject(new ProviderError("PROVIDER_TIMEOUT", "Provider timed out.", true)),
    };
    const handle = createMessageHandler(createSettingsService(), provider, agent);

    await expect(handle(connectionRequest)).resolves.toEqual({
      id: "test-1",
      ok: false,
      error: { code: "PROVIDER_TIMEOUT", message: "Provider timed out.", retryable: true },
    });
  });

  it("acknowledges an agent start before completion and emits the terminal result", async () => {
    let completeRun: ((result: AgentRunResult) => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<AgentRunResult>((resolve) => {
          completeRun = resolve;
        }),
    );
    const events: AgentEvent[] = [];
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(
      createSettingsService(),
      provider,
      { ...agent, run },
      (event) => {
        events.push(event);
      },
    );

    const response = await Promise.race([
      handle({
        id: "agent-start",
        type: "AGENT_RUN_REQUEST",
        payload: {
          runId: "run-long",
          instruction: "Long task",
          allowScreenshots: false,
          attachments: [],
        },
      }),
      new Promise<"still-running">((resolve) => {
        setTimeout(() => {
          resolve("still-running");
        }, 10);
      }),
    ]);

    expect(response).toEqual({
      id: "agent-start",
      ok: true,
      data: { runId: "run-long", started: true },
    });
    expect(events).toEqual([]);

    completeRun?.({ runId: "run-long", status: "completed", answer: "Done", steps: 20 });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "AGENT_FINISHED",
        payload: { runId: "run-long", status: "completed", answer: "Done", steps: 20 },
      });
    });
  });

  it("deduplicates a retried start request after an acknowledgement is lost", async () => {
    let completeRun: ((result: AgentRunResult) => void) | undefined;
    const run = vi.fn(
      () =>
        new Promise<AgentRunResult>((resolve) => {
          completeRun = resolve;
        }),
    );
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, {
      ...agent,
      run,
    });
    const payload = {
      runId: "run-retry",
      instruction: "Long task",
      allowScreenshots: false,
      attachments: [],
    };

    await expect(
      Promise.all([
        handle({ id: "agent-first", type: "AGENT_RUN_REQUEST", payload }),
        handle({ id: "agent-retry", type: "AGENT_RUN_REQUEST", payload }),
      ]),
    ).resolves.toMatchObject([
      { ok: true, data: { runId: "run-retry", started: true } },
      { ok: true, data: { runId: "run-retry", started: true } },
    ]);
    expect(run).toHaveBeenCalledOnce();
    completeRun?.({ runId: "run-retry", status: "completed", answer: "Done", steps: 1 });
  });

  it("emits a stable terminal error after an acknowledged agent start", async () => {
    const events: AgentEvent[] = [];
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(
      createSettingsService(),
      provider,
      {
        ...agent,
        run: () =>
          Promise.reject(new ProviderError("PROVIDER_TIMEOUT", "Provider timed out.", true)),
      },
      (event) => {
        events.push(event);
      },
    );

    await expect(
      handle({
        id: "agent-failure",
        type: "AGENT_RUN_REQUEST",
        payload: {
          runId: "run-failure",
          instruction: "Long task",
          allowScreenshots: false,
          attachments: [],
        },
      }),
    ).resolves.toMatchObject({ ok: true, data: { started: true } });
    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: "AGENT_FAILED",
        payload: {
          runId: "run-failure",
          error: { code: "PROVIDER_TIMEOUT", message: "Provider timed out.", retryable: true },
        },
      });
    });
  });

  it("reports an active run to heartbeat requests", async () => {
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, {
      ...agent,
      isRunning: () => true,
    });

    await expect(
      handle({ id: "heartbeat", type: "AGENT_KEEPALIVE", payload: { runId: "run-long" } }),
    ).resolves.toEqual({ id: "heartbeat", ok: true, data: { state: "active" } });
  });

  it("recovers a terminal event through heartbeat when event delivery is lost", async () => {
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, {
      ...agent,
      isRunning: () => false,
    });

    await handle({
      id: "agent-terminal-cache",
      type: "AGENT_RUN_REQUEST",
      payload: {
        runId: "run-finished",
        instruction: "Quick task",
        allowScreenshots: false,
        attachments: [],
      },
    });
    await vi.waitFor(async () => {
      await expect(
        handle({
          id: "heartbeat-terminal",
          type: "AGENT_KEEPALIVE",
          payload: { runId: "run-finished" },
        }),
      ).resolves.toEqual({
        id: "heartbeat-terminal",
        ok: true,
        data: {
          state: "terminal",
          event: {
            type: "AGENT_FINISHED",
            payload: { runId: "run-finished", status: "completed", answer: "Done", steps: 1 },
          },
        },
      });
    });
  });

  it("reports a missing run after service-worker state loss", async () => {
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, {
      ...agent,
      isRunning: () => false,
    });

    await expect(
      handle({ id: "heartbeat-missing", type: "AGENT_KEEPALIVE", payload: { runId: "lost" } }),
    ).resolves.toEqual({ id: "heartbeat-missing", ok: true, data: { state: "missing" } });
  });

  it("rejects a stale approval decision after run cleanup", async () => {
    const provider = {
      testConnection: () => Promise.resolve({ models: [], selectedModelAvailable: false }),
    };
    const handle = createMessageHandler(createSettingsService(), provider, {
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
    const handle = createMessageHandler(createSettingsService(), provider, agent);

    const result = await handle({ id: "bad-1", type: "UNKNOWN", payload: {} });

    expect(result).toMatchObject({ id: "bad-1", ok: false, error: { code: "INVALID_MESSAGE" } });
  });
});
