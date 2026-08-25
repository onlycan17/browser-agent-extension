import type { AgentRunResult } from "../shared/agent";
import type { ConnectionTestResult } from "../shared/llm";
import { parseRuntimeRequest, type RuntimeRequest, type RuntimeResponse } from "../shared/messages";
import type { PageAnalysisResult } from "../shared/page";
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

interface AnalysisService {
  analyze(prompt: string, includeScreenshot: boolean): Promise<PageAnalysisResult>;
}

interface AgentService {
  run(runId: string, instruction: string, includeScreenshot: boolean): Promise<AgentRunResult>;
  cancel(runId: string): boolean;
  decideApproval(runId: string, approvalId: string, approved: boolean): boolean;
}

function errorResponse(
  id: string,
  code: string,
  message: string,
  retryable = false,
): RuntimeResponse<never> {
  return { id, ok: false, error: { code, message, retryable } };
}

async function executeRequest(
  request: RuntimeRequest,
  settings: SettingsService,
  provider: ProviderService,
  analysis: AnalysisService,
  agent: AgentService,
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
  if (request.type === "PAGE_ANALYZE_REQUEST") {
    const result = await analysis.analyze(
      request.payload.prompt,
      request.payload.includeScreenshot,
    );
    return { id: request.id, ok: true, data: result };
  }
  if (request.type === "AGENT_RUN_REQUEST") {
    const result = await agent.run(
      request.payload.runId,
      request.payload.instruction,
      request.payload.includeScreenshot,
    );
    return { id: request.id, ok: true, data: result };
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
  if (error instanceof ProviderError || error instanceof PageAccessError) {
    return errorResponse(id, error.code, error.message, error.retryable);
  }
  return errorResponse(id, "INTERNAL_ERROR", "The extension could not complete the request.", true);
}

export function createMessageHandler(
  settings: SettingsService,
  provider: ProviderService,
  analysis: AnalysisService,
  agent: AgentService,
) {
  return async (message: unknown): Promise<RuntimeResponse<unknown>> => {
    const parsed = parseRuntimeRequest(message);
    if (!parsed.ok) return errorResponse(parsed.id, "INVALID_MESSAGE", parsed.error);
    try {
      return await executeRequest(parsed.value, settings, provider, analysis, agent);
    } catch (error: unknown) {
      return mapHandlerError(parsed.value.id, error);
    }
  };
}
