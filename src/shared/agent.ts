export interface AgentRunResult {
  runId: string;
  status: "completed" | "cancelled" | "step_limit";
  answer: string;
  steps: number;
}

export interface AgentProgressEvent {
  type: "AGENT_PROGRESS";
  payload: {
    runId: string;
    step: number;
    code: string;
    title: string;
    detail: string;
  };
}

export interface AgentApprovalEvent {
  type: "AGENT_APPROVAL_REQUIRED";
  payload: {
    runId: string;
    approvalId: string;
    title: string;
    detail: string;
  };
}

export interface AgentFinishedEvent {
  type: "AGENT_FINISHED";
  payload: { runId: string };
}

export type AgentEvent = AgentProgressEvent | AgentApprovalEvent | AgentFinishedEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseAgentEvent(value: unknown): AgentEvent | null {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  const payload = value.payload;
  if (typeof payload.runId !== "string") return null;
  if (value.type === "AGENT_FINISHED")
    return { type: value.type, payload: { runId: payload.runId } };
  if (value.type === "AGENT_PROGRESS") {
    if (!Number.isInteger(payload.step) || typeof payload.code !== "string") return null;
    if (typeof payload.title !== "string" || typeof payload.detail !== "string") return null;
    return {
      type: value.type,
      payload: {
        runId: payload.runId,
        step: Number(payload.step),
        code: payload.code,
        title: payload.title,
        detail: payload.detail,
      },
    };
  }
  if (value.type !== "AGENT_APPROVAL_REQUIRED") return null;
  if (typeof payload.approvalId !== "string" || typeof payload.title !== "string") return null;
  if (typeof payload.detail !== "string") return null;
  return {
    type: value.type,
    payload: {
      runId: payload.runId,
      approvalId: payload.approvalId,
      title: payload.title,
      detail: payload.detail,
    },
  };
}
