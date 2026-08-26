import type { RequestPayloadMap, ResponseDataMap } from "../shared/messages";
import { RuntimeRequestError } from "../shared/runtime-client";

type AgentStartPayload = RequestPayloadMap["AGENT_RUN_REQUEST"];
type AgentStartResult = ResponseDataMap["AGENT_RUN_REQUEST"];
type AgentStartSender = (payload: AgentStartPayload) => Promise<AgentStartResult>;

export async function startAgentWithRecovery(
  payload: AgentStartPayload,
  send: AgentStartSender,
): Promise<AgentStartResult> {
  try {
    return await send(payload);
  } catch (error: unknown) {
    if (!(error instanceof RuntimeRequestError) || error.code !== "RUNTIME_UNAVAILABLE")
      throw error;
    return send(payload);
  }
}
