import { describe, expect, it } from "vitest";
import { parseAgentEvent } from "../src/shared/agent";

describe("agent terminal events", () => {
  it("accepts a completed run result", () => {
    const event = parseAgentEvent({
      type: "AGENT_FINISHED",
      payload: { runId: "run-1", status: "completed", answer: "Done", steps: 14 },
    });

    expect(event).toEqual({
      type: "AGENT_FINISHED",
      payload: { runId: "run-1", status: "completed", answer: "Done", steps: 14 },
    });
  });

  it("accepts a safe terminal error", () => {
    const event = parseAgentEvent({
      type: "AGENT_FAILED",
      payload: {
        runId: "run-1",
        error: { code: "PROVIDER_TIMEOUT", message: "Provider timed out.", retryable: true },
      },
    });

    expect(event).toEqual({
      type: "AGENT_FAILED",
      payload: {
        runId: "run-1",
        error: { code: "PROVIDER_TIMEOUT", message: "Provider timed out.", retryable: true },
      },
    });
  });

  it("rejects malformed terminal events", () => {
    expect(
      parseAgentEvent({
        type: "AGENT_FINISHED",
        payload: { runId: "run-1", status: "completed", answer: "Done" },
      }),
    ).toBeNull();
    expect(
      parseAgentEvent({
        type: "AGENT_FAILED",
        payload: { runId: "run-1", error: { code: "BROKEN" } },
      }),
    ).toBeNull();
  });
});
