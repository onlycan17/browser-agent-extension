export const AGENT_KEEPALIVE_INTERVAL_MS = 20_000;

type HeartbeatSender = (runId: string) => Promise<void>;
type FailureHandler = (error: unknown) => void;

async function sendHeartbeat(
  runId: string,
  send: HeartbeatSender,
  fail: FailureHandler,
  settle: () => void,
): Promise<void> {
  try {
    await send(runId);
  } catch (error: unknown) {
    fail(error);
  } finally {
    settle();
  }
}

export function startAgentKeepAlive(
  runId: string,
  send: HeartbeatSender,
  onFailure: FailureHandler,
): () => void {
  let stopped = false,
    inFlight = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  const fail = (error: unknown): void => {
    if (stopped) return;
    stop();
    onFailure(error);
  };
  const heartbeat = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    await sendHeartbeat(runId, send, fail, () => {
      inFlight = false;
    });
  };
  const timer = setInterval(() => void heartbeat(), AGENT_KEEPALIVE_INTERVAL_MS);
  return stop;
}
