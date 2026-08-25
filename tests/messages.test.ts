import { describe, expect, it } from "vitest";
import { parseRuntimeRequest } from "../src/shared/messages";
import { DEFAULT_LOCAL_MODEL, LOCAL_BASE_URL } from "../src/shared/settings";

const settings = {
  provider: "local",
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
};

describe("runtime message parser", () => {
  it("accepts a validated settings request", () => {
    const result = parseRuntimeRequest({
      id: "request-1",
      type: "SETTINGS_SAVE",
      payload: settings,
    });

    expect(result).toEqual({
      ok: true,
      value: { id: "request-1", type: "SETTINGS_SAVE", payload: settings },
    });
  });

  it("accepts a client-generated agent run ID", () => {
    const result = parseRuntimeRequest({
      id: "request-2",
      type: "AGENT_RUN_REQUEST",
      payload: { runId: "run-1", instruction: "Inspect the page", includeScreenshot: false },
    });

    expect(result).toMatchObject({ ok: true, value: { payload: { runId: "run-1" } } });
  });

  it.each([
    [{ type: "SETTINGS_GET", payload: {} }, "Message type or ID"],
    [{ id: "1", type: "UNKNOWN", payload: {} }, "Message type or ID"],
    [{ id: "1", type: "SETTINGS_GET", payload: { extra: true } }, "payload"],
    [{ id: "1", type: "SETTINGS_GET", payload: {}, extra: true }, "envelope"],
    [
      {
        id: "1",
        type: "AGENT_RUN_REQUEST",
        payload: { instruction: "Missing run ID", includeScreenshot: false },
      },
      "Agent request",
    ],
    [{ id: "1", type: "AGENT_CANCEL", payload: { runId: "" } }, "Agent cancellation"],
  ])("rejects invalid envelope %#", (message, expected) => {
    const result = parseRuntimeRequest(message);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(expected);
  });
});
