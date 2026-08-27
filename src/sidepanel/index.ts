import {
  parseAgentEvent,
  type AgentApprovalEvent,
  type AgentEvent,
  type AgentFailedEvent,
  type AgentFinishedEvent,
} from "../shared/agent";
import {
  LocalNetworkAccessError,
  runProviderRequest,
  testProviderConnection,
} from "../shared/provider-connection";
import { RuntimeRequestError, sendRuntimeRequest } from "../shared/runtime-client";
import type { SettingsSummary } from "../shared/settings";
import { startAgentKeepAlive } from "./agent-keepalive";
import { startAgentWithRecovery } from "./agent-start";
import { AttachmentReadError, readSelectedAttachments } from "./attachment-reader";
import { AttachmentState, AttachmentStateError } from "./attachment-state";
import { renderAttachmentList, setAttachmentHelp } from "./attachment-view";
import { APPROVE_RUN_LABEL, approvalPresentation } from "./approval-presentation";
import {
  appendChatMessage,
  setConversationStatus,
  updateChatMessage,
  type ChatMessageActions,
  type ChatState,
} from "./chat-renderer";
import { copyResponse, shareResponse } from "./response-actions";
import { PanelRunState } from "./run-state";
import { consumeScreenshotConsent, resetScreenshotConsent } from "./screenshot-consent";

interface PanelElements {
  form: HTMLFormElement;
  prompt: HTMLTextAreaElement;
  includeScreenshot: HTMLInputElement;
  attachmentInput: HTMLInputElement;
  attachmentButton: HTMLLabelElement;
  attachmentHelp: HTMLParagraphElement;
  attachmentList: HTMLUListElement;
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
const attachmentState = new AttachmentState();
const ATTACHMENT_HELP = "이미지 · 텍스트 · PDF / 최대 5개";
let activeAgentMessage: HTMLLIElement | null = null;
let stopAgentKeepAlive: (() => void) | null = null;

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
    attachmentInput: getElement("#attachment-input", HTMLInputElement),
    attachmentButton: getElement("#attachment-button", HTMLLabelElement),
    attachmentHelp: getElement("#attachment-help", HTMLParagraphElement),
    attachmentList: getElement("#attachment-list", HTMLUListElement),
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

function userMessageBody(prompt: string): string {
  const names = attachmentState.snapshot().map((attachment) => attachment.name);
  return names.length === 0 ? prompt : `${prompt}\n\n첨부파일: ${names.join(", ")}`;
}

function startConversationTurn(
  elements: PanelElements,
  prompt: string,
  title: string,
  body: string,
): HTMLLIElement {
  appendChatMessage(elements.conversationLog, {
    role: "user",
    body: userMessageBody(prompt),
    state: "idle",
  });
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

function setAttachmentControlsDisabled(elements: PanelElements, disabled: boolean): void {
  elements.attachmentInput.disabled = disabled;
  elements.attachmentButton.setAttribute("aria-disabled", String(disabled));
  for (const button of elements.attachmentList.querySelectorAll<HTMLButtonElement>("button")) {
    button.disabled = disabled;
  }
}

function setComposerBusy(elements: PanelElements, busy: boolean): void {
  elements.runButton.disabled = busy;
  elements.includeScreenshot.disabled = busy;
  elements.prompt.readOnly = busy;
  setAttachmentControlsDisabled(elements, busy);
}

function setRunning(elements: PanelElements, running: boolean): void {
  setComposerBusy(elements, running);
  elements.stopButton.disabled = !running;
  elements.stopButton.hidden = !running;
}

function resultPresentation(
  status: "cancelled" | "completed" | "safety_limit",
): [string, ChatState] {
  if (status === "completed") return ["응답을 완료했어요", "complete"];
  if (status === "cancelled") return ["작업을 중지했어요", "cancelled"];
  return ["안전 한도에서 중지했어요", "cancelled"];
}

function closeAgentSession(elements: PanelElements, runId: string): void {
  if (!runState.finish(runId)) return;
  stopAgentKeepAlive?.();
  stopAgentKeepAlive = null;
  activeAgentMessage = null;
  clearApproval(elements);
  resetScreenshotConsent(elements.includeScreenshot);
  setRunning(elements, false);
}

function failAgentSession(elements: PanelElements, runId: string, error: unknown): void {
  if (!runState.matches(runId) || activeAgentMessage === null) return;
  finishConversationTurn(
    elements,
    activeAgentMessage,
    "요청을 완료하지 못했어요",
    formatError(error),
    "error",
  );
  closeAgentSession(elements, runId);
}

function keepAgentAlive(elements: PanelElements, runId: string): void {
  stopAgentKeepAlive?.();
  stopAgentKeepAlive = startAgentKeepAlive(
    runId,
    async (activeRunId) => {
      const result = await sendRuntimeRequest("AGENT_KEEPALIVE", { runId: activeRunId });
      if (result.state === "terminal") {
        handleAgentEvent(elements, result.event);
        return;
      }
      if (result.state === "missing") {
        throw new RuntimeRequestError(
          "AGENT_RUN_LOST",
          "확장 프로그램이 작업 실행 상태를 잃었습니다. 작업을 다시 시작해 주세요.",
          true,
        );
      }
    },
    (error) => {
      failAgentSession(elements, runId, error);
    },
  );
}

async function runAgent(elements: PanelElements): Promise<void> {
  const instruction = requirePrompt(elements);
  if (instruction === null) return;
  const attachments = attachmentState.snapshot();
  const allowScreenshots = consumeScreenshotConsent(elements.includeScreenshot);
  setRunning(elements, true);
  const runId = crypto.randomUUID();
  runState.begin(runId);
  activeAgentMessage = startConversationTurn(
    elements,
    instruction,
    "요청을 이해하고 있어요",
    "현재 페이지와 첨부를 살펴보고 필요한 계획을 세웁니다.",
  );
  try {
    const payload = {
      runId,
      instruction,
      allowScreenshots,
      attachments,
    };
    const settings = await sendRuntimeRequest("SETTINGS_GET", {});
    const result = await runProviderRequest(settings, () =>
      startAgentWithRecovery(payload, (value) => sendRuntimeRequest("AGENT_RUN_REQUEST", value)),
    );
    if (!runState.matches(runId)) return;
    if (!result.started || result.runId !== runId) {
      throw new RuntimeRequestError("INVALID_RESPONSE", "Agent start was not acknowledged.", true);
    }
    clearAttachments(elements);
    keepAgentAlive(elements, runId);
  } catch (error: unknown) {
    failAgentSession(elements, runId, error);
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
  const approve = approvalButton(APPROVE_RUN_LABEL, "button button--primary");
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

function handleTerminalEvent(
  elements: PanelElements,
  event: AgentFinishedEvent | AgentFailedEvent,
): void {
  if (activeAgentMessage === null) return;
  if (event.type === "AGENT_FINISHED") {
    const [title, state] = resultPresentation(event.payload.status);
    finishConversationTurn(elements, activeAgentMessage, title, event.payload.answer, state);
  } else {
    finishConversationTurn(
      elements,
      activeAgentMessage,
      "작업을 완료하지 못했어요",
      event.payload.error.message,
      "error",
    );
  }
  closeAgentSession(elements, event.payload.runId);
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
  handleTerminalEvent(elements, event);
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

function renderAttachments(elements: PanelElements): void {
  renderAttachmentList(elements.attachmentList, attachmentState.snapshot(), (index, attachment) => {
    attachmentState.remove(index);
    renderAttachments(elements);
    setLiveStatus(elements, `${attachment.name} 첨부파일을 제거했습니다.`);
  });
}

function clearAttachments(elements: PanelElements): void {
  attachmentState.clear();
  elements.attachmentInput.value = "";
  setAttachmentHelp(elements.attachmentHelp, ATTACHMENT_HELP);
  renderAttachments(elements);
}

function attachmentErrorMessage(error: unknown): string {
  if (error instanceof AttachmentReadError || error instanceof AttachmentStateError) {
    return error.message;
  }
  return "첨부파일을 읽지 못했습니다.";
}

async function selectAttachments(elements: PanelElements): Promise<void> {
  const files = Array.from(elements.attachmentInput.files ?? []);
  elements.attachmentInput.value = "";
  if (files.length === 0) return;
  setComposerBusy(elements, true);
  setAttachmentHelp(elements.attachmentHelp, "파일을 안전하게 읽고 있어요…", "loading");
  try {
    attachmentState.add(await readSelectedAttachments(files));
    renderAttachments(elements);
    setAttachmentHelp(elements.attachmentHelp, ATTACHMENT_HELP);
    setLiveStatus(elements, `${String(files.length)}개 첨부파일을 준비했습니다.`);
  } catch (error: unknown) {
    const message = attachmentErrorMessage(error);
    setAttachmentHelp(elements.attachmentHelp, message, "error");
    setLiveStatus(elements, message);
  } finally {
    setComposerBusy(elements, false);
  }
}

function registerEvents(elements: PanelElements): void {
  elements.settingsButton.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  elements.connectionButton.addEventListener("click", () => void testConnection(elements));
  elements.attachmentInput.addEventListener("change", () => void selectAttachments(elements));
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
