import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_KEEPALIVE_INTERVAL_MS, startAgentKeepAlive } from "../src/sidepanel/agent-keepalive";

describe("agent keepalive", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends heartbeats while a run is active and stops cleanly", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const onFailure = vi.fn();
    const stop = startAgentKeepAlive("run-1", send, onFailure);

    await vi.advanceTimersByTimeAsync(AGENT_KEEPALIVE_INTERVAL_MS * 2);
    expect(send).toHaveBeenNthCalledWith(1, "run-1");
    expect(send).toHaveBeenNthCalledWith(2, "run-1");

    stop();
    await vi.advanceTimersByTimeAsync(AGENT_KEEPALIVE_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("does not overlap heartbeats while one is unresolved", async () => {
    let resolveSend: (() => void) | undefined;
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const stop = startAgentKeepAlive("run-1", send, vi.fn());

    await vi.advanceTimersByTimeAsync(AGENT_KEEPALIVE_INTERVAL_MS * 3);
    expect(send).toHaveBeenCalledOnce();

    resolveSend?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(AGENT_KEEPALIVE_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reports a failed heartbeat once and stops", async () => {
    const error = new Error("message channel closed");
    const send = vi.fn().mockRejectedValue(error);
    const onFailure = vi.fn();
    startAgentKeepAlive("run-1", send, onFailure);

    await vi.advanceTimersByTimeAsync(AGENT_KEEPALIVE_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(AGENT_KEEPALIVE_INTERVAL_MS);

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith(error);
    expect(send).toHaveBeenCalledOnce();
  });
});
