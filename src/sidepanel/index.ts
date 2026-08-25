import { parseAgentEvent, type AgentApprovalEvent, type AgentEvent } from "../shared/agent";
import { LocalNetworkAccessError, testProviderConnection } from "../shared/provider-connection";
import { RuntimeRequestError, sendRuntimeRequest } from "../shared/runtime-client";
import type { SettingsSummary } from "../shared/settings";
import { approvalPresentation } from "./approval-presentation";
import {
  appendChatMessage,
  setConversationStatus,
  updateChatMessage,
  type ChatMessageActions,
  type ChatState,
} from "./chat-renderer";
import { copyResponse, shareResponse } from "./response-actions";
import { PanelRunState } from "./run-state";

interface PanelElements {
  form: HTMLFormElement;
  prompt: HTMLTextAreaElement;
  includeScreenshot: HTMLInputElement;
  analyzeButton: HTMLButtonElement;
  runButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  settingsButton: HTMLButtonElement;
  connectionButton: HTMLButtonElement;
  providerLabel: HTMLElement;
  modelLabel: HTMLElement;
  connectionDot: HTMLElement;
  conversationLog: HTMLOListElement;
  conversationStatus: HTMLElement;
  approvalRegion: HTMLElement;
  liveStatus: HTMLElement;
}

const runState = new PanelRunState();
let activeAgentMessage: HTMLLIElement | null = null;

type ElementConstructor<T extends Element> = new () => T;

function getElement<T extends Element>(selector: string, type: ElementConstructor<T>): T {
  const element = document.querySelector(selector);
  if (!(element instanceof type))
    throw new Error(`Missing required side panel element: ${selector}`);
  return element;
}

function collectElements(): PanelElements {
  return {
    form: getElement("#prompt-form", HTMLFormElement),
    prompt: getElement("#prompt-input", HTMLTextAreaElement),
    includeScreenshot: getElement("#include-screenshot", HTMLInputElement),
    analyzeButton: getElement("#analyze-button", HTMLButtonElement),
    runButton: getElement("#run-button", HTMLButtonElement),
    stopButton: getElement("#stop-button", HTMLButtonElement),
    settingsButton: getElement("#settings-button", HTMLButtonElement),
    connectionButton: getElement("#connection-button", HTMLButtonElement),
    providerLabel: getElement("#provider-label", HTMLElement),
    modelLabel: getElement("#model-label", HTMLElement),
    connectionDot: getElement("#connection-dot", HTMLElement),
    conversationLog: getElement("#conversation-log", HTMLOListElement),
    conversationStatus: getElement("#conversation-status", HTMLElement),
    approvalRegion: getElement("#approval-region", HTMLElement),
    liveStatus: getElement("#live-status", HTMLElement),
  };
}

function setConnectionState(elements: PanelElements, state: string): void {
  elements.connectionDot.dataset.state = state;
}

function setConversationState(elements: PanelElements, state: ChatState): void {
  setConversationStatus(elements.conversationStatus, state);
  elements.conversationLog.setAttribute(
    "aria-busy",
    String(state === "thinking" || state === "waiting"),
  );
}

function renderSettings(elements: PanelElements, settings: SettingsSummary): void {
  elements.providerLabel.textContent = settings.provider.toUpperCase();
  elements.modelLabel.textContent = settings.model;
  setConnectionState(elements, "idle");
}

function setLiveStatus(elements: PanelElements, message: string): void {
  elements.liveStatus.textContent = message;
}

function responseActionHandlers(elements: PanelElements): ChatMessageActions {
  return {
    announce: (message) => {
      setLiveStatus(elements, message);
    },
    copy: (message) => copyResponse(message.body),
    share: (message) => shareResponse(message.title ?? "", message.body),
  };
}

function addSystemMessage(
  elements: PanelElements,
  title: string,
  body: string,
  state: ChatState,
): void {
  appendChatMessage(elements.conversationLog, { role: "system", title, body, state });
}

function startConversationTurn(
  elements: PanelElements,
  prompt: string,
  title: string,
  body: string,
): HTMLLIElement {
  appendChatMessage(elements.conversationLog, { role: "user", body: prompt, state: "idle" });
  const response = appendChatMessage(
    elements.conversationLog,
    {
      role: "assistant",
      title,
      body,
      state: "thinking",
    },
    responseActionHandlers(elements),
  );
  setConversationState(elements, "thinking");
  elements.prompt.value = "";
  return response;
}

function finishConversationTurn(
  elements: PanelElements,
  response: HTMLLIElement,
  title: string,
  body: string,
  state: ChatState,
): void {
  updateChatMessage(response, { role: "assistant", title, body, state });
  setConversationState(elements, state);
  setLiveStatus(elements, state === "complete" ? "응답이 완료되었습니다." : body);
}

function requirePrompt(elements: PanelElements): string | null {
  const prompt = elements.prompt.value.trim();
  if (prompt.length > 0) return prompt;
  setLiveStatus(elements, "먼저 작업 내용을 입력해 주세요.");
  elements.prompt.focus();
  return null;
}

function setAnalyzing(elements: PanelElements, analyzing: boolean): void {
  elements.analyzeButton.disabled = analyzing;
  elements.runButton.disabled = analyzing;
  elements.prompt.readOnly = analyzing;
}

async function analyzePage(elements: PanelElements): Promise<void> {
  const prompt = requirePrompt(elements);
  if (prompt === null) return;
  setAnalyzing(elements, true);
  const response = startConversationTurn(
    elements,
    prompt,
    "화면을 살펴보고 있어요",
    "페이지 구조를 읽고 요청 내용을 분석합니다.",
  );
  try {
    const result = await sendRuntimeRequest("PAGE_ANALYZE_REQUEST", {
      prompt,
      includeScreenshot: elements.includeScreenshot.checked,
    });
    finishConversationTurn(elements, response, result.title, result.answer, "complete");
  } catch (error: unknown) {
    finishConversationTurn(
      elements,
      response,
      "화면 분석에 실패했어요",
      formatError(error),
      "error",
    );
  } finally {
    setAnalyzing(elements, false);
  }
}

function setRunning(elements: PanelElements, running: boolean): void {
  elements.runButton.disabled = running;
  elements.analyzeButton.disabled = running;
  elements.stopButton.disabled = !running;
  elements.prompt.readOnly = running;
}

function resultPresentation(status: "cancelled" | "completed" | "step_limit"): [string, ChatState] {
  if (status === "completed") return ["작업을 완료했어요", "complete"];
  if (status === "cancelled") return ["작업을 중지했어요", "cancelled"];
  return ["단계 제한에 도달했어요", "cancelled"];
}

async function runAgent(elements: PanelElements): Promise<void> {
  const instruction = requirePrompt(elements);
  if (instruction === null) return;
  setRunning(elements, true);
  const runId = crypto.randomUUID();
  runState.begin(runId);
  activeAgentMessage = startConversationTurn(
    elements,
    instruction,
    "작업을 시작했어요",
    "현재 페이지를 관찰하고 다음 동작을 판단합니다.",
  );
  try {
    const result = await sendRuntimeRequest("AGENT_RUN_REQUEST", {
      runId,
      instruction,
      includeScreenshot: elements.includeScreenshot.checked,
    });
    const [title, state] = resultPresentation(result.status);
    finishConversationTurn(elements, activeAgentMessage, title, result.answer, state);
  } catch (error: unknown) {
    finishConversationTurn(
      elements,
      activeAgentMessage,
      "작업을 완료하지 못했어요",
      formatError(error),
      "error",
    );
  } finally {
    if (runState.finish(runId)) {
      activeAgentMessage = null;
      clearApproval(elements);
      setRunning(elements, false);
    }
  }
}

async function cancelAgent(elements: PanelElements): Promise<void> {
  const runId = runState.activeId();
  if (runId === null) return;
  try {
    const result = await sendRuntimeRequest("AGENT_CANCEL", { runId });
    setLiveStatus(
      elements,
      result.cancelled ? "에이전트를 중지했습니다." : "실행 중인 에이전트가 없습니다.",
    );
  } catch (error: unknown) {
    addSystemMessage(elements, "에이전트 중지 실패", formatError(error), "error");
    setConversationState(elements, "error");
  }
}

function clearApproval(elements: PanelElements): void {
  elements.approvalRegion.replaceChildren();
  elements.approvalRegion.hidden = true;
}

function setApprovalButtonsDisabled(
  buttons: readonly HTMLButtonElement[],
  disabled: boolean,
): void {
  for (const button of buttons) button.disabled = disabled;
}

async function decideApproval(
  elements: PanelElements,
  event: AgentApprovalEvent,
  approved: boolean,
  buttons: readonly HTMLButtonElement[],
): Promise<void> {
  setApprovalButtonsDisabled(buttons, true);
  try {
    const result = await sendRuntimeRequest("ACTION_APPROVAL_DECISION", {
      runId: event.payload.runId,
      approvalId: event.payload.approvalId,
      approved,
    });
    if (!runState.matches(event.payload.runId) || activeAgentMessage === null) return;
    clearApproval(elements);
    const presentation = approvalPresentation(approved, result.accepted);
    updateProgress(activeAgentMessage, presentation.title, presentation.body, presentation.state);
    setConversationState(elements, presentation.state);
    setLiveStatus(elements, presentation.body);
  } catch (error: unknown) {
    if (!runState.matches(event.payload.runId)) return;
    setApprovalButtonsDisabled(buttons, false);
    addSystemMessage(elements, "승인 결정을 전달하지 못했어요", formatError(error), "error");
    setConversationState(elements, "error");
  }
}

function approvalButton(label: string, className: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  return button;
}

function showApproval(elements: PanelElements, event: AgentApprovalEvent): void {
  const title = document.createElement("strong");
  const detail = document.createElement("p");
  const actions = document.createElement("div");
  const deny = approvalButton("거부", "button button--secondary");
  const approve = approvalButton("한 번 승인", "button button--primary");
  title.textContent = event.payload.title;
  detail.textContent = event.payload.detail;
  actions.className = "approval-actions";
  const buttons = [deny, approve] as const;
  deny.addEventListener("click", () => void decideApproval(elements, event, false, buttons));
  approve.addEventListener("click", () => void decideApproval(elements, event, true, buttons));
  actions.append(...buttons);
  elements.approvalRegion.replaceChildren(title, detail, actions);
  elements.approvalRegion.hidden = false;
}

function updateProgress(
  message: HTMLLIElement,
  title: string,
  body: string,
  state: ChatState,
): void {
  updateChatMessage(message, { role: "assistant", title, body, state });
}

function handleAgentEvent(elements: PanelElements, event: AgentEvent): void {
  if (!runState.matches(event.payload.runId) || activeAgentMessage === null) return;
  if (event.type === "AGENT_PROGRESS") {
    updateProgress(activeAgentMessage, event.payload.title, event.payload.detail, "thinking");
    return;
  }
  if (event.type === "AGENT_APPROVAL_REQUIRED") {
    updateProgress(activeAgentMessage, "승인이 필요해요", event.payload.detail, "waiting");
    showApproval(elements, event);
    setConversationState(elements, "waiting");
    setLiveStatus(elements, "사용자 승인이 필요한 동작입니다.");
    return;
  }
  clearApproval(elements);
}

function formatError(error: unknown): string {
  if (error instanceof RuntimeRequestError || error instanceof LocalNetworkAccessError)
    return error.message;
  return "확장 프로그램 요청을 완료하지 못했습니다.";
}

async function testConnection(elements: PanelElements): Promise<void> {
  setConnectionState(elements, "working");
  elements.connectionButton.disabled = true;
  try {
    const settings = await sendRuntimeRequest("SETTINGS_GET", {});
    const result = await testProviderConnection(settings, () =>
      sendRuntimeRequest("CONNECTION_TEST", {}),
    );
    setConnectionState(elements, result.selectedModelAvailable ? "ready" : "error");
    const detail = result.selectedModelAvailable ? "선택 모델 사용 가능" : "선택 모델을 찾지 못함";
    addSystemMessage(
      elements,
      "모델 서버 연결 확인",
      detail,
      result.selectedModelAvailable ? "complete" : "error",
    );
    setLiveStatus(elements, detail);
  } catch (error: unknown) {
    setConnectionState(elements, "error");
    addSystemMessage(elements, "모델 서버 연결 실패", formatError(error), "error");
    setLiveStatus(elements, formatError(error));
  } finally {
    elements.connectionButton.disabled = false;
  }
}

function registerEvents(elements: PanelElements): void {
  elements.settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  elements.connectionButton.addEventListener("click", () => void testConnection(elements));
  elements.analyzeButton.addEventListener("click", () => void analyzePage(elements));
  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    void runAgent(elements);
  });
  elements.stopButton.addEventListener("click", () => void cancelAgent(elements));
}

async function initialize(): Promise<void> {
  const elements = collectElements();
  registerEvents(elements);
  chrome.runtime.onMessage.addListener((message: unknown) => {
    const event = parseAgentEvent(message);
    if (event !== null) handleAgentEvent(elements, event);
    return false;
  });
  try {
    renderSettings(elements, await sendRuntimeRequest("SETTINGS_GET", {}));
    setConversationState(elements, "idle");
    setLiveStatus(elements, "Browser Agent가 준비되었습니다.");
  } catch (error: unknown) {
    setConnectionState(elements, "error");
    addSystemMessage(elements, "설정을 불러오지 못했어요", formatError(error), "error");
  }
}

void initialize();
