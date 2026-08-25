import type { AgentEvent } from "../shared/agent";
import { ALLOWED_KEYS, type PageActionRequest } from "../shared/actions";
import type { ToolCall, ToolDefinition, ToolMessage } from "../shared/llm";
import type { ObservedElement, PageSnapshot } from "../shared/page";
import { ApprovalManager } from "./approval-manager";
import { SafetyPolicy, type ActionProposal, type SafetyDecision } from "./safety-policy";

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click an element from the latest page observation by its exact ID.",
      parameters: {
        type: "object",
        properties: {
          generation: { type: "integer" },
          elementId: { type: "string" },
        },
        required: ["generation", "elementId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "type_text",
      description: "Enter text into an editable element from the latest observation.",
      parameters: {
        type: "object",
        properties: {
          generation: { type: "integer" },
          elementId: { type: "string" },
          text: { type: "string", maxLength: 4000 },
          replace: { type: "boolean" },
        },
        required: ["generation", "elementId", "text", "replace"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "press_key",
      description: "Press one allowed keyboard key on the active element.",
      parameters: {
        type: "object",
        properties: { key: { type: "string", enum: ALLOWED_KEYS } },
        required: ["key"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scroll_page",
      description: "Scroll the current page in one direction by a bounded pixel amount.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "integer", minimum: 1, maximum: 2000 },
        },
        required: ["direction", "amount"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "youtube_control",
      description: "Control the YouTube player on the current page.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["play", "pause", "seek", "set_volume", "set_rate"],
          },
          value: { type: "number" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  },
];

type ParsedTool =
  | { name: "click_element"; generation: number; elementId: string }
  | { name: "type_text"; generation: number; elementId: string; text: string; replace: boolean }
  | { name: "press_key"; key: (typeof ALLOWED_KEYS)[number] }
  | { name: "scroll_page"; direction: "up" | "down" | "left" | "right"; amount: number }
  | { name: "youtube_control"; action: "play" | "pause" }
  | {
      name: "youtube_control";
      action: "seek" | "set_volume" | "set_rate";
      value: number;
    };

export interface ToolExecutionResult {
  message: ToolMessage;
  failed: boolean;
  signature: string;
}

interface ActionService {
  executeAction(action: PageActionRequest, runId: string): Promise<{ message: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseTarget(
  name: "click_element" | "type_text",
  value: Record<string, unknown>,
): ParsedTool | null {
  if (!Number.isInteger(value.generation) || typeof value.elementId !== "string") return null;
  const generation = Number(value.generation);
  const elementId = value.elementId;
  if (name === "click_element" && hasOnlyKeys(value, ["generation", "elementId"])) {
    return { name: "click_element", generation, elementId };
  }
  if (name !== "type_text" || !hasOnlyKeys(value, ["generation", "elementId", "text", "replace"]))
    return null;
  if (
    typeof value.text !== "string" ||
    value.text.length > 4000 ||
    typeof value.replace !== "boolean"
  )
    return null;
  return { name: "type_text", generation, elementId, text: value.text, replace: value.replace };
}

function parseYouTubeTool(value: Record<string, unknown>): ParsedTool | null {
  if (value.action === "play" || value.action === "pause") {
    return hasOnlyKeys(value, ["action"])
      ? { name: "youtube_control", action: value.action }
      : null;
  }
  const actions = ["seek", "set_volume", "set_rate"] as const;
  const action = actions.find((item) => item === value.action);
  if (action === undefined || !hasOnlyKeys(value, ["action", "value"])) return null;
  return typeof value.value === "number" && Number.isFinite(value.value)
    ? { name: "youtube_control", action, value: value.value }
    : null;
}

function parseTool(call: ToolCall): ParsedTool | null {
  let value: unknown;
  try {
    value = JSON.parse(call.function.arguments) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (call.function.name === "click_element" || call.function.name === "type_text") {
    return parseTarget(call.function.name, value);
  }
  if (call.function.name === "press_key" && hasOnlyKeys(value, ["key"])) {
    const key = ALLOWED_KEYS.find((item) => item === value.key);
    return key === undefined ? null : { name: "press_key", key };
  }
  if (call.function.name === "youtube_control") return parseYouTubeTool(value);
  if (call.function.name !== "scroll_page" || !hasOnlyKeys(value, ["direction", "amount"]))
    return null;
  const directions = ["up", "down", "left", "right"] as const;
  const direction = directions.find((item) => item === value.direction);
  if (direction === undefined || !Number.isInteger(value.amount)) return null;
  const amount = Number(value.amount);
  return amount < 1 || amount > 2000 ? null : { name: "scroll_page", direction, amount };
}

function observedElement(tool: ParsedTool, snapshot: PageSnapshot): ObservedElement | null {
  if (!("elementId" in tool) || tool.generation !== snapshot.generation) return null;
  return snapshot.elements.find((element) => element.id === tool.elementId) ?? null;
}

function actionProposal(tool: ParsedTool, snapshot: PageSnapshot): ActionProposal | null {
  if (tool.name === "scroll_page") return { action: "scroll" };
  if (tool.name === "youtube_control") return { action: "youtube_control" };
  if (tool.name === "press_key") return { action: "press_key", key: tool.key };
  const element = observedElement(tool, snapshot);
  if (element === null) return null;
  return tool.name === "click_element"
    ? { action: "click", element, pageUrl: snapshot.url }
    : { action: "type_text", element };
}

function pageAction(tool: ParsedTool): PageActionRequest {
  if (tool.name === "click_element") {
    return {
      type: "PAGE_CLICK",
      payload: { generation: tool.generation, elementId: tool.elementId },
    };
  }
  if (tool.name === "type_text") {
    const { generation, elementId, text, replace } = tool;
    return { type: "PAGE_TYPE_TEXT", payload: { generation, elementId, text, replace } };
  }
  if (tool.name === "press_key") return { type: "PAGE_PRESS_KEY", payload: { key: tool.key } };
  if (tool.name === "youtube_control") {
    return "value" in tool
      ? { type: "YOUTUBE_CONTROL", payload: { action: tool.action, value: tool.value } }
      : { type: "YOUTUBE_CONTROL", payload: { action: tool.action } };
  }
  return { type: "PAGE_SCROLL", payload: { direction: tool.direction, amount: tool.amount } };
}

function signature(tool: ParsedTool): string {
  if (tool.name === "type_text")
    return `${tool.name}:${String(tool.generation)}:${tool.elementId}:${String(tool.replace)}`;
  if (tool.name === "click_element")
    return `${tool.name}:${String(tool.generation)}:${tool.elementId}`;
  if (tool.name === "press_key") return `${tool.name}:${tool.key}`;
  if (tool.name === "youtube_control") {
    return "value" in tool
      ? `${tool.name}:${tool.action}:${String(tool.value)}`
      : `${tool.name}:${tool.action}`;
  }
  return `${tool.name}:${tool.direction}:${String(tool.amount)}`;
}

export function toolCallSignature(call: ToolCall): string {
  const tool = parseTool(call);
  return tool === null ? `invalid:${call.function.name}` : signature(tool);
}

function toolMessage(callId: string, value: Record<string, unknown>): ToolMessage {
  return { role: "tool", tool_call_id: callId, content: JSON.stringify(value) };
}

function approvalCopy(
  tool: ParsedTool,
  element: ObservedElement | null,
): { title: string; detail: string } {
  const target =
    [element?.name, element?.role].find((value) => value !== undefined && value.length > 0) ??
    "현재 요소";
  if (tool.name === "click_element") return { title: "클릭 승인 필요", detail: target };
  if (tool.name === "press_key") return { title: "키 입력 승인 필요", detail: tool.key };
  return { title: "작업 승인 필요", detail: target };
}

export class AgentToolExecutor {
  constructor(
    private readonly actions: ActionService,
    private readonly policy: SafetyPolicy,
    private readonly approvals: ApprovalManager,
    private readonly emit: (event: AgentEvent) => void,
  ) {}

  async execute(
    call: ToolCall,
    snapshot: PageSnapshot,
    runId: string,
    signal: AbortSignal,
  ): Promise<ToolExecutionResult> {
    const tool = parseTool(call);
    if (tool === null) return this.failure(call.id, "Tool arguments are invalid.", "invalid");
    const proposal = actionProposal(tool, snapshot);
    if (proposal === null)
      return this.failure(call.id, "The observed element is stale.", signature(tool));
    const decision = this.policy.evaluate(proposal);
    if (decision.outcome === "deny") return this.failure(call.id, decision.reason, signature(tool));
    if (decision.outcome === "confirm") {
      const approved = await this.requestApproval(runId, tool, proposal, decision, signal);
      if (!approved)
        return this.failure(call.id, "The user did not approve this action.", signature(tool));
    }
    signal.throwIfAborted();
    try {
      const result = await this.actions.executeAction(pageAction(tool), runId);
      return {
        message: toolMessage(call.id, { ok: true, message: result.message }),
        failed: false,
        signature: signature(tool),
      };
    } catch {
      return this.failure(call.id, "The page rejected this action.", signature(tool));
    }
  }

  private async requestApproval(
    runId: string,
    tool: ParsedTool,
    proposal: ActionProposal,
    decision: Extract<SafetyDecision, { outcome: "confirm" }>,
    signal: AbortSignal,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const approvalId = crypto.randomUUID();
    const element = "element" in proposal ? proposal.element : null;
    const copy = approvalCopy(tool, element);
    this.emit({
      type: "AGENT_APPROVAL_REQUIRED",
      payload: {
        runId,
        approvalId,
        title: copy.title,
        detail: `${copy.detail} · ${decision.reason}`,
      },
    });
    return this.approvals.request(runId, approvalId);
  }

  private failure(callId: string, message: string, toolSignature: string): ToolExecutionResult {
    return {
      message: toolMessage(callId, { ok: false, error: message }),
      failed: true,
      signature: toolSignature,
    };
  }
}
