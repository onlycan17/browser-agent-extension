import { describe, expect, it, vi } from "vitest";
import { RuntimeRequestError } from "../src/shared/runtime-client";
import { startAgentWithRecovery } from "../src/sidepanel/agent-start";

const payload = {
  runId: "run-recovery",
  instruction: "Inspect the page",
  allowScreenshots: false,
  attachments: [],
};

describe("agent start recovery", () => {
  it("retries the same run after a lost runtime acknowledgement", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new RuntimeRequestError("RUNTIME_UNAVAILABLE", "lost", true))
      .mockResolvedValueOnce({ runId: payload.runId, started: true });

    await expect(startAgentWithRecovery(payload, send)).resolves.toEqual({
      runId: payload.runId,
      started: true,
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, payload);
    expect(send).toHaveBeenNthCalledWith(2, payload);
  });

  it("does not retry non-transport failures", async () => {
    const error = new RuntimeRequestError("INVALID_RESPONSE", "invalid", false);
    const send = vi.fn().mockRejectedValue(error);

    await expect(startAgentWithRecovery(payload, send)).rejects.toBe(error);
    expect(send).toHaveBeenCalledOnce();
  });
});
