import type { AgentTerminalEvent } from "./agent";
import { parseRequestAttachments, type RequestAttachment } from "./attachments";
import type { ConnectionTestResult } from "./llm";
import { parseProviderSettings, type ProviderSettings, type SettingsSummary } from "./settings";

export interface RequestPayloadMap {
  SETTINGS_GET: Record<string, never>;
  SETTINGS_SAVE: ProviderSettings;
  CONNECTION_TEST: Record<string, never>;
  AGENT_RUN_REQUEST: {
    runId: string;
    instruction: string;
    allowScreenshots: boolean;
    attachments: RequestAttachment[];
  };
  AGENT_KEEPALIVE: { runId: string };
  AGENT_CANCEL: { runId: string };
  ACTION_APPROVAL_DECISION: { runId: string; approvalId: string; approved: boolean };
}

export interface ResponseDataMap {
  SETTINGS_GET: SettingsSummary;
  SETTINGS_SAVE: SettingsSummary;
  CONNECTION_TEST: ConnectionTestResult;
  AGENT_RUN_REQUEST: { runId: string; started: boolean };
  AGENT_KEEPALIVE:
    { state: "active" } | { state: "terminal"; event: AgentTerminalEvent } | { state: "missing" };
  AGENT_CANCEL: { cancelled: boolean };
  ACTION_APPROVAL_DECISION: { accepted: boolean };
}

export type RequestType = keyof RequestPayloadMap;

export type RuntimeRequest<T extends RequestType = RequestType> = {
  [K in T]: { id: string; type: K; payload: RequestPayloadMap[K] };
}[T];

export interface RuntimeErrorData {
  code: string;
  message: string;
  retryable: boolean;
}

export type RuntimeResponse<T> =
  { id: string; ok: true; data: T } | { id: string; ok: false; error: RuntimeErrorData };

export type RequestParseResult =
  { ok: true; value: RuntimeRequest } | { ok: false; id: string; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestType(value: unknown): value is RequestType {
  return (
    value === "SETTINGS_GET" ||
    value === "SETTINGS_SAVE" ||
    value === "CONNECTION_TEST" ||
    value === "AGENT_RUN_REQUEST" ||
    value === "AGENT_KEEPALIVE" ||
    value === "AGENT_CANCEL" ||
    value === "ACTION_APPROVAL_DECISION"
  );
}

function hasOnlyKeys(record: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function parseEmptyPayload(value: unknown): Record<string, never> | null {
  if (!isRecord(value) || Object.keys(value).length > 0) return null;
  return {};
}

function parseAgentRun(value: unknown): RequestPayloadMap["AGENT_RUN_REQUEST"] | null {
  const keys = ["runId", "instruction", "allowScreenshots", "attachments"];
  if (!isRecord(value) || !hasOnlyKeys(value, keys)) return null;
  if (typeof value.runId !== "string" || value.runId.length === 0 || value.runId.length > 128)
    return null;
  if (typeof value.instruction !== "string" || typeof value.allowScreenshots !== "boolean")
    return null;
  const instruction = value.instruction.trim();
  const attachments = parseRequestAttachments(value.attachments);
  if (instruction.length === 0 || instruction.length > 4000 || attachments === null) return null;
  return { runId: value.runId, instruction, allowScreenshots: value.allowScreenshots, attachments };
}

function parseRunId(value: unknown): { runId: string } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["runId"])) return null;
  return typeof value.runId === "string" && value.runId.length > 0 && value.runId.length <= 128
    ? { runId: value.runId }
    : null;
}

function parseApproval(value: unknown): RequestPayloadMap["ACTION_APPROVAL_DECISION"] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["runId", "approvalId", "approved"])) return null;
  if (typeof value.runId !== "string" || typeof value.approvalId !== "string") return null;
  if (typeof value.approved !== "boolean") return null;
  return { runId: value.runId, approvalId: value.approvalId, approved: value.approved };
}

function requestId(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== "string") return "unknown";
  return value.id;
}

export function parseRuntimeRequest(value: unknown): RequestParseResult {
  const id = requestId(value);
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "type", "payload"])) {
    return { ok: false, id, error: "Message envelope is invalid." };
  }
  if (
    typeof value.id !== "string" ||
    id.length === 0 ||
    id.length > 128 ||
    !isRequestType(value.type)
  ) {
    return { ok: false, id, error: "Message type or ID is invalid." };
  }
  if (value.type === "SETTINGS_SAVE") {
    const settings = parseProviderSettings(value.payload);
    return settings.ok
      ? { ok: true, value: { id, type: value.type, payload: settings.value } }
      : { ok: false, id, error: settings.error };
  }
  if (value.type === "AGENT_RUN_REQUEST") {
    const payload = parseAgentRun(value.payload);
    return payload === null
      ? { ok: false, id, error: "Agent request is invalid." }
      : { ok: true, value: { id, type: value.type, payload } };
  }
  if (value.type === "AGENT_KEEPALIVE" || value.type === "AGENT_CANCEL") {
    const payload = parseRunId(value.payload);
    const error =
      value.type === "AGENT_KEEPALIVE"
        ? "Agent keepalive is invalid."
        : "Agent cancellation is invalid.";
    return payload === null
      ? { ok: false, id, error }
      : { ok: true, value: { id, type: value.type, payload } };
  }
  if (value.type === "ACTION_APPROVAL_DECISION") {
    const payload = parseApproval(value.payload);
    return payload === null
      ? { ok: false, id, error: "Approval decision is invalid." }
      : { ok: true, value: { id, type: value.type, payload } };
  }
  const payload = parseEmptyPayload(value.payload);
  if (payload === null) return { ok: false, id, error: "Message payload is invalid." };
  return { ok: true, value: { id, type: value.type, payload } };
}
