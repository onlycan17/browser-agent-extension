import type { RequestAttachment } from "../shared/attachments";
import { attachmentSummary } from "./attachment-presentation";

export type AttachmentHelpState = "error" | "loading";
export type AttachmentRemoveHandler = (index: number, attachment: RequestAttachment) => void;

export function setAttachmentHelp(
  element: HTMLParagraphElement,
  message: string,
  state?: AttachmentHelpState,
): void {
  element.textContent = message;
  if (state === undefined) delete element.dataset.state;
  else element.dataset.state = state;
}

function attachmentChip(
  attachment: RequestAttachment,
  index: number,
  onRemove: AttachmentRemoveHandler,
): HTMLLIElement {
  const item = document.createElement("li");
  const content = document.createElement("span");
  const name = document.createElement("span");
  const metadata = document.createElement("span");
  const remove = document.createElement("button");
  item.className = "attachment-chip";
  if (attachment.kind === "text" && attachment.truncated) item.dataset.state = "truncated";
  content.className = "attachment-chip__content";
  name.className = "attachment-chip__name";
  name.textContent = attachment.name;
  metadata.className = "attachment-chip__metadata";
  metadata.textContent = attachmentSummary(attachment);
  remove.type = "button";
  remove.className = "attachment-chip__remove";
  remove.textContent = "×";
  remove.setAttribute("aria-label", `${attachment.name} 첨부 제거`);
  remove.addEventListener("click", () => {
    onRemove(index, attachment);
  });
  content.append(name, metadata);
  item.append(content, remove);
  return item;
}

export function renderAttachmentList(
  list: HTMLUListElement,
  attachments: readonly RequestAttachment[],
  onRemove: AttachmentRemoveHandler,
): void {
  const chips = attachments.map((attachment, index) => attachmentChip(attachment, index, onRemove));
  list.replaceChildren(...chips);
  list.hidden = chips.length === 0;
}
