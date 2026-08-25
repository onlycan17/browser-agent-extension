export type ChatRole = "assistant" | "system" | "user";
export type ChatState = "cancelled" | "complete" | "error" | "idle" | "thinking" | "waiting";

export interface ChatMessage {
  body: string;
  role: ChatRole;
  state?: ChatState;
  title?: string;
}

const STATE_LABELS: Readonly<Record<ChatState, string>> = {
  cancelled: "중지됨",
  complete: "응답 완료",
  error: "오류",
  idle: "안내",
  thinking: "생각 중",
  waiting: "승인 대기",
};

function appendInlineText(parent: HTMLElement, value: string): void {
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let offset = 0;
  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index;
    parent.append(document.createTextNode(value.slice(offset, index)));
    const token = match[0];
    const element = document.createElement(token.startsWith("**") ? "strong" : "code");
    element.textContent = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
    parent.append(element);
    offset = index + token.length;
  }
  parent.append(document.createTextNode(value.slice(offset)));
}

function appendListItem(
  parent: HTMLElement,
  value: string,
  ordered: boolean,
  currentList: HTMLUListElement | HTMLOListElement | null,
): HTMLUListElement | HTMLOListElement {
  const tagName = ordered ? "OL" : "UL";
  const list =
    currentList?.tagName === tagName ? currentList : document.createElement(ordered ? "ol" : "ul");
  if (list !== currentList) parent.append(list);
  const item = document.createElement("li");
  appendInlineText(item, value);
  list.append(item);
  return list;
}

function appendMarkdownLine(
  parent: HTMLElement,
  line: string,
  currentList: HTMLUListElement | HTMLOListElement | null,
): HTMLUListElement | HTMLOListElement | null {
  if (line.trim().length === 0) return null;
  const heading = /^#{1,3}\s+(.+)$/.exec(line);
  if (heading?.[1]) {
    const element = document.createElement("h4");
    appendInlineText(element, heading[1]);
    parent.append(element);
    return null;
  }
  const bullet = /^[-*]\s+(.+)$/.exec(line);
  if (bullet?.[1]) return appendListItem(parent, bullet[1], false, currentList);
  const numbered = /^\d+[.)]\s+(.+)$/.exec(line);
  if (numbered?.[1]) return appendListItem(parent, numbered[1], true, currentList);
  const paragraph = document.createElement("p");
  appendInlineText(paragraph, line);
  parent.append(paragraph);
  return null;
}

function renderBody(parent: HTMLElement, body: string, role: ChatRole): void {
  parent.replaceChildren();
  if (role === "user") {
    const paragraph = document.createElement("p");
    paragraph.textContent = body;
    parent.append(paragraph);
    return;
  }
  let currentList: HTMLUListElement | HTMLOListElement | null = null;
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    currentList = appendMarkdownLine(parent, line, currentList);
  }
}

function speakerLabel(role: ChatRole): string {
  if (role === "user") return "나";
  if (role === "system") return "시스템";
  return "Browser Agent";
}

export function setConversationStatus(element: HTMLElement, state: ChatState): void {
  element.dataset.state = state;
  element.textContent = STATE_LABELS[state];
}

function isNearBottom(container: HTMLElement): boolean {
  const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
  return remaining <= 48;
}

function scrollToLatest(entry: HTMLLIElement, shouldScroll: boolean): void {
  const container = entry.parentElement;
  if (shouldScroll && container) container.scrollTop = container.scrollHeight;
}

export function updateChatMessage(entry: HTMLLIElement, message: ChatMessage): void {
  const container = entry.parentElement;
  const shouldScroll = container ? isNearBottom(container) : false;
  entry.dataset.state = message.state ?? "idle";
  const title = entry.querySelector<HTMLElement>(".chat-message__title");
  const body = entry.querySelector<HTMLElement>(".chat-message__body");
  const status = entry.querySelector<HTMLElement>(".chat-message__status");
  if (title) title.textContent = message.title ?? "";
  if (body) renderBody(body, message.body, message.role);
  if (status) status.textContent = STATE_LABELS[message.state ?? "idle"];
  scrollToLatest(entry, shouldScroll);
}

export function appendChatMessage(
  container: HTMLOListElement,
  message: ChatMessage,
): HTMLLIElement {
  const shouldScroll = isNearBottom(container);
  const entry = document.createElement("li");
  const article = document.createElement("article");
  const header = document.createElement("header");
  const speaker = document.createElement("span");
  const status = document.createElement("span");
  const title = document.createElement("h3");
  const body = document.createElement("div");
  entry.className = `chat-message chat-message--${message.role}`;
  article.className = "chat-message__bubble";
  header.className = "chat-message__meta";
  speaker.className = "chat-message__speaker";
  status.className = "chat-message__status";
  title.className = "chat-message__title";
  body.className = "chat-message__body";
  speaker.textContent = speakerLabel(message.role);
  header.append(speaker, status);
  article.append(header, title, body);
  entry.append(article);
  container.append(entry);
  updateChatMessage(entry, message);
  scrollToLatest(entry, shouldScroll);
  return entry;
}
