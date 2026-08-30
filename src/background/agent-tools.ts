import type { AgentEvent } from "../shared/agent";
import { ALLOWED_KEYS, type PageActionRequest, type PageActionResult } from "../shared/actions";
import type { ToolCall, ToolDefinition, ToolMessage } from "../shared/llm";
import type { ObservedElement, PageSnapshot } from "../shared/page";
import { ApprovalManager } from "./approval-manager";
import { SafetyPolicy, type ActionProposal, type SafetyDecision } from "./safety-policy";
import { PageActionError } from "./tab-service";

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "summarize_video_transcript",
      description:
        "Summarize an opened transcript in bounded chunks and hierarchically merge the results. Use this for a long or full-video transcript instead of manually scrolling through transcript text.",
      parameters: {
        type: "object",
        properties: {
          focus: {
            type: "string",
            maxLength: 500,
            description: "Optional emphasis from the user's request.",
          },
        },
        additionalProperties: false,
      },
    },
  },
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
      name: "select_option",
      description:
        "Select one option by its exact observed label from a select element in the latest page observation.",
      parameters: {
        type: "object",
        properties: {
          generation: { type: "integer" },
          elementId: { type: "string" },
          optionLabel: { type: "string", maxLength: 300 },
        },
        required: ["generation", "elementId", "optionLabel"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_checked",
      description:
        "Set an observed checkbox state, or select an observed radio option with checked=true.",
      parameters: {
        type: "object",
        properties: {
          generation: { type: "integer" },
          elementId: { type: "string" },
          checked: { type: "boolean" },
        },
        required: ["generation", "elementId", "checked"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "scroll_element",
      description:
        "Scroll an observed nested container, such as a modal, list, menu, or grid, by a bounded pixel amount.",
      parameters: {
        type: "object",
        properties: {
          generation: { type: "integer" },
          elementId: { type: "string" },
          direction: { type: "string", enum: ["up", "down", "left", "right"] },
          amount: { type: "integer", minimum: 1, maximum: 2000 },
        },
        required: ["generation", "elementId", "direction", "amount"],
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
      name: "youtube_search",
      description:
        "Search YouTube videos directly without browsing, returning videoId, title, and channel per result. Works while the current page is on youtube.com.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", maxLength: 200, description: "The search query." },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 10,
            description: "Maximum number of videos to return. Defaults to 5.",
          },
        },
        required: ["query", "limit"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "youtube_control",
      description:
        "Use this tool for YouTube play, pause, seek, playback rate, and volume changes. For a combined request, make one call for each requested state change. Do not click visible player controls for operations supported by this tool.",
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

const CREATE_PLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "create_plan",
    description:
      "Break a complex multi-step request into an explicit ordered plan of 2-10 short subtasks before acting. Skip this for requests a single action or a direct answer can complete.",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string", maxLength: 200 },
          description:
            "Ordered subtasks in short imperative form. Provide 2-10 steps, each 1-200 characters.",
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
  },
};

const UPDATE_PLAN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_plan",
    description:
      "Record progress on the active plan. Call this after finishing each subtask so the plan stays accurate.",
    parameters: {
      type: "object",
      properties: {
        completedSteps: {
          type: "integer",
          minimum: 0,
          description: "Number of plan steps already finished.",
        },
        currentStep: {
          type: "string",
          maxLength: 200,
          description: "The subtask being worked on now.",
        },
      },
      required: ["completedSteps", "currentStep"],
      additionalProperties: false,
    },
  },
};

const SAVE_MEMORY_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "save_memory",
    description:
      "Record one short, reusable lesson or user preference about this website so future runs on the same site start smarter. Save at most one note per run, only when it is genuinely reusable, right before the final answer.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          maxLength: 300,
          description:
            "One reusable lesson, 5-300 characters, such as a reliable path through this site or a user preference.",
        },
        kind: { type: "string", enum: ["success", "preference"] },
      },
      required: ["note", "kind"],
      additionalProperties: false,
    },
  },
};

const PAUSE_FOR_USER_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "pause_for_user",
    description:
      "Pause and ask the user to complete a step that must be done as themselves, such as signing in, approving an email, or solving a verification prompt. Describe exactly what the user should do. Never handle passwords, payment card data, or authentication codes yourself.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          maxLength: 300,
          description: "What the user should do before the agent continues, 3-300 characters.",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
};

const LOAD_SKILL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "load_skill",
    description:
      "Load the full guidance of one bundled skill by its exact catalog name. Use it when the task matches a listed skill, before acting on that site.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          maxLength: 80,
          description: "The exact skill name from the bundled skill catalog.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
};

const CAPTURE_SCREEN_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "capture_screen",
    description:
      "Capture the currently visible viewport when visual information is necessary. The user must enable screenshot access for this run.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

export function agentTools(allowScreenshots: boolean): ToolDefinition[] {
  const tools = [
    ...AGENT_TOOLS,
    CREATE_PLAN_TOOL,
    UPDATE_PLAN_TOOL,
    SAVE_MEMORY_TOOL,
    PAUSE_FOR_USER_TOOL,
    LOAD_SKILL_TOOL,
  ];
  return allowScreenshots ? [...tools, CAPTURE_SCREEN_TOOL] : tools;
}

type ParsedTool =
  | { name: "click_element"; generation: number; elementId: string }
  | { name: "type_text"; generation: number; elementId: string; text: string; replace: boolean }
  | { name: "select_option"; generation: number; elementId: string; optionLabel: string }
  | { name: "set_checked"; generation: number; elementId: string; checked: boolean }
  | {
      name: "scroll_element";
      generation: number;
      elementId: string;
      direction: "up" | "down" | "left" | "right";
      amount: number;
    }
  | { name: "press_key"; key: (typeof ALLOWED_KEYS)[number] }
  | { name: "scroll_page"; direction: "up" | "down" | "left" | "right"; amount: number }
  | { name: "youtube_control"; action: "play" | "pause" }
  | {
      name: "youtube_control";
      action: "seek" | "set_volume" | "set_rate";
      value: number;
    }
  | { name: "youtube_search"; query: string; limit: number };

export interface ToolExecutionResult {
  message: ToolMessage;
  failed: boolean;
  signature: string;
  retryableFailure?: boolean;
  pageSettled?: boolean;
}

interface ActionService {
  executeAction(
    action: PageActionRequest,
    runId: string,
    signal?: AbortSignal,
  ): Promise<PageActionResult>;
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
  if (
    !Number.isInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.elementId !== "string" ||
    value.elementId.length === 0 ||
    value.elementId.length > 80
  ) {
    return null;
  }
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

function parseGuardedElementTool(
  name: "select_option" | "set_checked" | "scroll_element",
  value: Record<string, unknown>,
): ParsedTool | null {
  if (
    !Number.isInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.elementId !== "string" ||
    value.elementId.length === 0 ||
    value.elementId.length > 80
  ) {
    return null;
  }
  const generation = Number(value.generation);
  const elementId = value.elementId;
  if (name === "select_option") {
    if (!hasOnlyKeys(value, ["generation", "elementId", "optionLabel"])) return null;
    if (
      typeof value.optionLabel !== "string" ||
      value.optionLabel.length === 0 ||
      value.optionLabel.length > 300
    ) {
      return null;
    }
    return { name, generation, elementId, optionLabel: value.optionLabel };
  }
  if (name === "set_checked") {
    if (
      !hasOnlyKeys(value, ["generation", "elementId", "checked"]) ||
      typeof value.checked !== "boolean"
    ) {
      return null;
    }
    return { name, generation, elementId, checked: value.checked };
  }
  if (!hasOnlyKeys(value, ["generation", "elementId", "direction", "amount"])) return null;
  const directions = ["up", "down", "left", "right"] as const;
  const direction = directions.find((item) => item === value.direction);
  if (direction === undefined || !Number.isInteger(value.amount)) return null;
  const amount = Number(value.amount);
  return amount < 1 || amount > 2000 ? null : { name, generation, elementId, direction, amount };
}

function parseYouTubeSearchTool(value: Record<string, unknown>): ParsedTool | null {
  if (!hasOnlyKeys(value, ["query", "limit"])) return null;
  if (typeof value.query !== "string" || value.query.trim().length === 0) return null;
  if (value.query.length > 200) return null;
  if (!Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 10)
    return null;
  return { name: "youtube_search", query: value.query.trim(), limit: Number(value.limit) };
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

export interface PlanStep {
  text: string;
  status: "done" | "in_progress" | "pending";
}

export type PlanCall =
  | { name: "create_plan"; steps: string[] }
  | { name: "update_plan"; completedSteps: number; currentStep: string };

export function parsePlanCall(call: ToolCall): PlanCall | null {
  if (call.function.name !== "create_plan" && call.function.name !== "update_plan") return null;
  try {
    const value = JSON.parse(call.function.arguments) as unknown;
    if (!isRecord(value)) return null;
    if (call.function.name === "create_plan") {
      if (!hasOnlyKeys(value, ["steps"])) return null;
      const steps = value.steps;
      if (!Array.isArray(steps) || steps.length < 1 || steps.length > 10) return null;
      const normalized = steps.map((step) => (typeof step === "string" ? step.trim() : ""));
      if (steps.some((step) => typeof step !== "string")) return null;
      if (normalized.some((text) => text.length === 0 || text.length > 200)) return null;
      return { name: "create_plan", steps: normalized };
    }
    if (!hasOnlyKeys(value, ["completedSteps", "currentStep"])) return null;
    if (!Number.isInteger(value.completedSteps) || Number(value.completedSteps) < 0) return null;
    if (typeof value.currentStep !== "string") return null;
    const currentStep = value.currentStep.trim();
    if (currentStep.length === 0 || currentStep.length > 200) return null;
    return { name: "update_plan", completedSteps: Number(value.completedSteps), currentStep };
  } catch {
    return null;
  }
}

export function isCaptureScreenCall(call: ToolCall): boolean {
  if (call.function.name !== "capture_screen") return false;
  try {
    const value = JSON.parse(call.function.arguments) as unknown;
    return isRecord(value) && hasOnlyKeys(value, []);
  } catch {
    return false;
  }
}

export function parseTranscriptSummaryCall(call: ToolCall): { focus: string } | null {
  if (call.function.name !== "summarize_video_transcript") return null;
  try {
    const value = JSON.parse(call.function.arguments) as unknown;
    if (!isRecord(value) || !hasOnlyKeys(value, ["focus"])) return null;
    if (value.focus === undefined) return { focus: "" };
    if (typeof value.focus !== "string" || value.focus.length > 500) return null;
    return { focus: value.focus.trim() };
  } catch {
    return null;
  }
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
  if (
    call.function.name === "select_option" ||
    call.function.name === "set_checked" ||
    call.function.name === "scroll_element"
  ) {
    return parseGuardedElementTool(call.function.name, value);
  }
  if (call.function.name === "press_key" && hasOnlyKeys(value, ["key"])) {
    const key = ALLOWED_KEYS.find((item) => item === value.key);
    return key === undefined ? null : { name: "press_key", key };
  }
  if (call.function.name === "youtube_control") return parseYouTubeTool(value);
  if (call.function.name === "youtube_search") return parseYouTubeSearchTool(value);
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
  if (tool.name === "youtube_search") return { action: "youtube_search" };
  if (tool.name === "press_key") return { action: "press_key", key: tool.key };
  const element = observedElement(tool, snapshot);
  if (element === null) return null;
  if (tool.name === "select_option") return { action: "select_option", element };
  if (tool.name === "set_checked") return { action: "set_checked", element };
  if (tool.name === "scroll_element") return { action: "scroll_element", element };
  return tool.name === "click_element"
    ? { action: "click", element, pageUrl: snapshot.url }
    : { action: "type_text", element };
}

function pageAction(tool: ParsedTool, element: ObservedElement | null): PageActionRequest {
  if (tool.name === "click_element") {
    if (element === null) throw new Error("Observed element is required.");
    return {
      type: "PAGE_CLICK",
      payload: { generation: tool.generation, elementId: tool.elementId, expected: element },
    };
  }
  if (tool.name === "type_text") {
    if (element === null) throw new Error("Observed element is required.");
    const { generation, elementId, text, replace } = tool;
    return {
      type: "PAGE_TYPE_TEXT",
      payload: { generation, elementId, text, replace, expected: element },
    };
  }
  if (tool.name === "select_option") {
    if (element === null) throw new Error("Observed element is required.");
    return {
      type: "PAGE_SELECT_OPTION",
      payload: {
        generation: tool.generation,
        elementId: tool.elementId,
        optionLabel: tool.optionLabel,
        expected: element,
      },
    };
  }
  if (tool.name === "set_checked") {
    if (element === null) throw new Error("Observed element is required.");
    return {
      type: "PAGE_SET_CHECKED",
      payload: {
        generation: tool.generation,
        elementId: tool.elementId,
        checked: tool.checked,
        expected: element,
      },
    };
  }
  if (tool.name === "scroll_element") {
    if (element === null) throw new Error("Observed element is required.");
    return {
      type: "PAGE_SCROLL_ELEMENT",
      payload: {
        generation: tool.generation,
        elementId: tool.elementId,
        direction: tool.direction,
        amount: tool.amount,
        expected: element,
      },
    };
  }
  if (tool.name === "press_key") return { type: "PAGE_PRESS_KEY", payload: { key: tool.key } };
  if (tool.name === "youtube_search") {
    return { type: "YOUTUBE_SEARCH", payload: { query: tool.query, limit: tool.limit } };
  }
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
  if (tool.name === "select_option")
    return `${tool.name}:${String(tool.generation)}:${tool.elementId}:${textFingerprint(tool.optionLabel)}`;
  if (tool.name === "set_checked")
    return `${tool.name}:${String(tool.generation)}:${tool.elementId}:${String(tool.checked)}`;
  if (tool.name === "scroll_element")
    return `${tool.name}:${String(tool.generation)}:${tool.elementId}:${tool.direction}:${String(tool.amount)}`;
  if (tool.name === "press_key") return `${tool.name}:${tool.key}`;
  if (tool.name === "youtube_search") {
    return `${tool.name}:${textFingerprint(tool.query)}:${String(tool.limit)}`;
  }
  if (tool.name === "youtube_control") {
    return "value" in tool
      ? `${tool.name}:${tool.action}:${String(tool.value)}`
      : `${tool.name}:${tool.action}`;
  }
  return `${tool.name}:${tool.direction}:${String(tool.amount)}`;
}

export interface SaveMemoryCall {
  note: string;
  kind: "success" | "preference";
}

export function parseSaveMemoryCall(call: ToolCall): SaveMemoryCall | null {
  if (call.function.name !== "save_memory") return null;
  try {
    const value = JSON.parse(call.function.arguments) as unknown;
    if (!isRecord(value) || !hasOnlyKeys(value, ["note", "kind"])) return null;
    if (typeof value.note !== "string" || typeof value.kind !== "string") return null;
    const note = value.note.trim();
    if (note.length < 5 || note.length > 300) return null;
    if (value.kind !== "success" && value.kind !== "preference") return null;
    return { note, kind: value.kind };
  } catch {
    return null;
  }
}

export function parseSkillLoadCall(call: ToolCall): { name: string } | null {
  if (call.function.name !== "load_skill") return null;
  try {
    const value = JSON.parse(call.function.arguments) as unknown;
    if (!isRecord(value) || !hasOnlyKeys(value, ["name"])) return null;
    if (typeof value.name !== "string") return null;
    const name = value.name.trim();
    if (name.length === 0 || name.length > 80) return null;
    return { name };
  } catch {
    return null;
  }
}

export function parsePauseForUserCall(call: ToolCall): { reason: string } | null {
  if (call.function.name !== "pause_for_user") return null;
  try {
    const value = JSON.parse(call.function.arguments) as unknown;
    if (!isRecord(value) || !hasOnlyKeys(value, ["reason"])) return null;
    if (typeof value.reason !== "string") return null;
    const reason = value.reason.trim();
    if (reason.length < 3 || reason.length > 300) return null;
    return { reason };
  } catch {
    return null;
  }
}

function planCallSignature(plan: PlanCall): string {
  if (plan.name === "create_plan") {
    return `create_plan:${textFingerprint(plan.steps.join("|"))}`;
  }
  return `update_plan:${String(plan.completedSteps)}:${textFingerprint(plan.currentStep)}`;
}

export function parseToolCallArguments(call: ToolCall): ParsedTool | null {
  return parseTool(call);
}

export function toolCallSignature(call: ToolCall): string {
  const skill = parseSkillLoadCall(call);
  if (skill !== null) return `load_skill:${skill.name}`;
  const pause = parsePauseForUserCall(call);
  if (pause !== null) return `pause_for_user:${textFingerprint(pause.reason)}`;
  const memory = parseSaveMemoryCall(call);
  if (memory !== null) return `save_memory:${textFingerprint(memory.note)}`;
  const plan = parsePlanCall(call);
  if (plan !== null) return planCallSignature(plan);
  if (isCaptureScreenCall(call)) return "capture_screen";
  const transcript = parseTranscriptSummaryCall(call);
  if (transcript !== null) return `summarize_video_transcript:${textFingerprint(transcript.focus)}`;
  const tool = parseTool(call);
  return tool === null ? `invalid:${call.function.name}` : signature(tool);
}

function textFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(16);
}

export function toolCallProgressSignature(call: ToolCall): string {
  const skill = parseSkillLoadCall(call);
  if (skill !== null) return `load_skill:${skill.name}`;
  const pause = parsePauseForUserCall(call);
  if (pause !== null) return `pause_for_user:${textFingerprint(pause.reason)}`;
  const memory = parseSaveMemoryCall(call);
  if (memory !== null) return `save_memory:${textFingerprint(memory.note)}`;
  const plan = parsePlanCall(call);
  if (plan !== null) return planCallSignature(plan);
  if (isCaptureScreenCall(call)) return "capture_screen";
  const transcript = parseTranscriptSummaryCall(call);
  if (transcript !== null) return `summarize_video_transcript:${textFingerprint(transcript.focus)}`;
  const tool = parseTool(call);
  if (tool === null)
    return `invalid:${call.function.name}:${textFingerprint(call.function.arguments)}`;
  if (tool.name !== "type_text") return signature(tool);
  return `${signature(tool)}:${textFingerprint(tool.text)}`;
}

export function toolCallMayNavigate(call: ToolCall): boolean {
  const tool = parseTool(call);
  return (
    tool?.name === "click_element" ||
    tool?.name === "select_option" ||
    tool?.name === "set_checked" ||
    (tool?.name === "press_key" && tool.key === "Enter")
  );
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
  if (tool.name === "select_option") return { title: "선택 변경 승인 필요", detail: target };
  if (tool.name === "set_checked") return { title: "체크 상태 변경 승인 필요", detail: target };
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
      const element = "element" in proposal ? proposal.element : null;
      const result = await this.actions.executeAction(pageAction(tool, element), runId, signal);
      signal.throwIfAborted();
      return {
        message: toolMessage(call.id, {
          ok: true,
          message: result.message,
          ...(result.pageSettled === undefined ? {} : { pageSettled: result.pageSettled }),
          ...(result.data === undefined ? {} : { data: result.data }),
        }),
        failed: false,
        signature: signature(tool),
        ...(result.pageSettled === undefined ? {} : { pageSettled: result.pageSettled }),
      };
    } catch (error: unknown) {
      if (error instanceof PageActionError) {
        return this.failure(call.id, error.message, signature(tool), error.code, error.retryable);
      }
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
    if (this.approvals.isRunApproved(runId)) return true;
    const approvalId = crypto.randomUUID();
    const element = "element" in proposal ? proposal.element : null;
    const copy = approvalCopy(tool, element);
    const decisionPromise = this.approvals.request(runId, approvalId);
    this.emit({
      type: "AGENT_APPROVAL_REQUIRED",
      payload: {
        runId,
        approvalId,
        title: copy.title,
        detail: `${copy.detail} · ${decision.reason} · 승인하면 이 요청의 후속 승인 대상 동작도 함께 허용됩니다.`,
      },
    });
    return decisionPromise;
  }

  private failure(
    callId: string,
    message: string,
    toolSignature: string,
    code?: string,
    retryable = false,
  ): ToolExecutionResult {
    return {
      message: toolMessage(callId, {
        ok: false,
        ...(code === undefined ? {} : { code }),
        error: message,
        ...(code === undefined ? {} : { retryable }),
      }),
      failed: true,
      signature: toolSignature,
      ...(retryable ? { retryableFailure: true } : {}),
    };
  }
}
