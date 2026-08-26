export interface AgentRunResult {
  runId: string;
  status: "completed" | "cancelled" | "safety_limit";
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
  payload: AgentRunResult;
}

export interface AgentFailedEvent {
  type: "AGENT_FAILED";
  payload: {
    runId: string;
    error: { code: string; message: string; retryable: boolean };
  };
}

export type AgentTerminalEvent = AgentFinishedEvent | AgentFailedEvent;

export type AgentEvent = AgentProgressEvent | AgentApprovalEvent | AgentTerminalEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRunStatus(value: unknown): value is AgentRunResult["status"] {
  return value === "completed" || value === "cancelled" || value === "safety_limit";
}

function parseFinishedEvent(payload: Record<string, unknown>): AgentFinishedEvent | null {
  if (!isRunStatus(payload.status) || typeof payload.answer !== "string") return null;
  if (!Number.isInteger(payload.steps) || Number(payload.steps) < 0) return null;
  return {
    type: "AGENT_FINISHED",
    payload: {
      runId: String(payload.runId),
      status: payload.status,
      answer: payload.answer,
      steps: Number(payload.steps),
    },
  };
}

function parseFailedEvent(payload: Record<string, unknown>): AgentFailedEvent | null {
  if (!isRecord(payload.error)) return null;
  const { code, message, retryable } = payload.error;
  if (typeof code !== "string" || typeof message !== "string") return null;
  if (typeof retryable !== "boolean") return null;
  return {
    type: "AGENT_FAILED",
    payload: { runId: String(payload.runId), error: { code, message, retryable } },
  };
}

export function parseAgentEvent(value: unknown): AgentEvent | null {
  if (!isRecord(value) || !isRecord(value.payload)) return null;
  const payload = value.payload;
  if (typeof payload.runId !== "string") return null;
  if (value.type === "AGENT_FINISHED") return parseFinishedEvent(payload);
  if (value.type === "AGENT_FAILED") return parseFailedEvent(payload);
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
