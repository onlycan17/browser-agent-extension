import type { AgentEvent, AgentRunResult, AgentTerminalEvent } from "../shared/agent";
import type { RequestAttachment } from "../shared/attachments";
import type { ConnectionTestResult } from "../shared/llm";
import {
  parseRuntimeRequest,
  type ResponseDataMap,
  type RuntimeErrorData,
  type RuntimeRequest,
  type RuntimeResponse,
} from "../shared/messages";
import type { ProviderSettings, SettingsSummary, ValidationResult } from "../shared/settings";
import { ProviderError } from "./openai-client";
import { PageAccessError } from "./tab-service";

interface SettingsService {
  loadRuntime(): Promise<ProviderSettings>;
  loadSummary(): Promise<SettingsSummary>;
  save(value: unknown): Promise<ValidationResult<SettingsSummary>>;
}

interface ProviderService {
  testConnection(settings: ProviderSettings): Promise<ConnectionTestResult>;
}

interface AgentService {
  run(
    runId: string,
    instruction: string,
    allowScreenshots: boolean,
    attachments: readonly RequestAttachment[],
  ): Promise<AgentRunResult>;
  isRunning(runId: string): boolean;
  cancel(runId: string): boolean;
  decideApproval(runId: string, approvalId: string, approved: boolean): boolean;
}

type AgentEventEmitter = (event: AgentEvent) => void;
type TerminalEvents = Map<string, AgentTerminalEvent>;
type AcceptedRuns = Set<string>;

const MAX_TERMINAL_EVENTS = 20;

function errorResponse(
  id: string,
  code: string,
  message: string,
  retryable = false,
): RuntimeResponse<never> {
  return { id, ok: false, error: { code, message, retryable } };
}

function mappedError(error: unknown): RuntimeErrorData {
  if (error instanceof ProviderError || error instanceof PageAccessError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "The extension could not complete the request.",
    retryable: true,
  };
}

function rememberTerminal(events: TerminalEvents, event: AgentTerminalEvent): void {
  const runId = event.payload.runId;
  events.delete(runId);
  if (events.size >= MAX_TERMINAL_EVENTS) {
    const oldest = events.keys().next().value;
    if (typeof oldest === "string") events.delete(oldest);
  }
  events.set(runId, event);
}

function publishTerminal(
  event: AgentTerminalEvent,
  events: TerminalEvents,
  emit: AgentEventEmitter,
): void {
  rememberTerminal(events, event);
  emit(event);
}

function startAgentRun(
  request: Extract<RuntimeRequest, { type: "AGENT_RUN_REQUEST" }>,
  agent: AgentService,
  events: TerminalEvents,
  acceptedRuns: AcceptedRuns,
  emit: AgentEventEmitter,
): void {
  const { runId, instruction, allowScreenshots, attachments } = request.payload;
  events.delete(runId);
  acceptedRuns.add(runId);
  void Promise.resolve()
    .then(() => agent.run(runId, instruction, allowScreenshots, attachments))
    .then(
      (result) => {
        acceptedRuns.delete(runId);
        publishTerminal({ type: "AGENT_FINISHED", payload: result }, events, emit);
      },
      (error: unknown) => {
        acceptedRuns.delete(runId);
        const event: AgentTerminalEvent = {
          type: "AGENT_FAILED",
          payload: { runId, error: mappedError(error) },
        };
        publishTerminal(event, events, emit);
      },
    );
}

function heartbeatState(
  runId: string,
  agent: AgentService,
  events: TerminalEvents,
): ResponseDataMap["AGENT_KEEPALIVE"] {
  if (agent.isRunning(runId)) return { state: "active" };
  const event = events.get(runId);
  return event === undefined ? { state: "missing" } : { state: "terminal", event };
}

async function executeRequest(
  request: RuntimeRequest,
  settings: SettingsService,
  provider: ProviderService,
  agent: AgentService,
  events: TerminalEvents,
  acceptedRuns: AcceptedRuns,
  emit: AgentEventEmitter,
): Promise<RuntimeResponse<unknown>> {
  if (request.type === "SETTINGS_GET") {
    return { id: request.id, ok: true, data: await settings.loadSummary() };
  }
  if (request.type === "SETTINGS_SAVE") {
    const result = await settings.save(request.payload);
    return result.ok
      ? { id: request.id, ok: true, data: result.value }
      : errorResponse(request.id, "INVALID_MESSAGE", result.error);
  }
  if (request.type === "AGENT_RUN_REQUEST") {
    const { runId } = request.payload;
    const known = acceptedRuns.has(runId) || agent.isRunning(runId) || events.has(runId);
    if (!known) startAgentRun(request, agent, events, acceptedRuns, emit);
    return {
      id: request.id,
      ok: true,
      data: { runId: request.payload.runId, started: true },
    };
  }
  if (request.type === "AGENT_KEEPALIVE") {
    const data = heartbeatState(request.payload.runId, agent, events);
    return { id: request.id, ok: true, data };
  }
  if (request.type === "AGENT_CANCEL") {
    return { id: request.id, ok: true, data: { cancelled: agent.cancel(request.payload.runId) } };
  }
  if (request.type === "ACTION_APPROVAL_DECISION") {
    const accepted = agent.decideApproval(
      request.payload.runId,
      request.payload.approvalId,
      request.payload.approved,
    );
    return { id: request.id, ok: true, data: { accepted } };
  }
  const runtimeSettings = await settings.loadRuntime();
  return { id: request.id, ok: true, data: await provider.testConnection(runtimeSettings) };
}

function mapHandlerError(id: string, error: unknown): RuntimeResponse<never> {
  const mapped = mappedError(error);
  return errorResponse(id, mapped.code, mapped.message, mapped.retryable);
}

export function createMessageHandler(
  settings: SettingsService,
  provider: ProviderService,
  agent: AgentService,
  emit: AgentEventEmitter = () => undefined,
) {
  const terminalEvents: TerminalEvents = new Map();
  const acceptedRuns: AcceptedRuns = new Set();
  return async (message: unknown): Promise<RuntimeResponse<unknown>> => {
    const parsed = parseRuntimeRequest(message);
    if (!parsed.ok) return errorResponse(parsed.id, "INVALID_MESSAGE", parsed.error);
    try {
      return await executeRequest(
        parsed.value,
        settings,
        provider,
        agent,
        terminalEvents,
        acceptedRuns,
        emit,
      );
    } catch (error: unknown) {
      return mapHandlerError(parsed.value.id, error);
    }
  };
}
