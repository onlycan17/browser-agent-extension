import { parseRequestAttachments, type RequestAttachment } from "../shared/attachments";

export class AttachmentStateError extends Error {
  constructor() {
    super("첨부파일의 개수 또는 전체 크기 제한을 초과했습니다.");
    this.name = "AttachmentStateError";
  }
}

export class AttachmentState {
  private attachments: RequestAttachment[] = [];

  add(values: readonly RequestAttachment[]): void {
    const parsed = parseRequestAttachments([...this.attachments, ...values]);
    if (parsed === null) throw new AttachmentStateError();
    this.attachments = parsed;
  }

  remove(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.attachments.length) return;
    this.attachments = this.attachments.filter((_, itemIndex) => itemIndex !== index);
  }

  clear(): void {
    this.attachments = [];
  }

  snapshot(): RequestAttachment[] {
    return [...this.attachments];
  }
}
