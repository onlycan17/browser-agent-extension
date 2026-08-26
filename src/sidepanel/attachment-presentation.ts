import type { RequestAttachment } from "../shared/attachments";

const TYPE_LABELS: Record<RequestAttachment["mediaType"], string> = {
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "text/plain": "TXT",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
  "application/json": "JSON",
  "text/html": "HTML",
  "application/xml": "XML",
  "application/pdf": "PDF",
};

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentSummary(attachment: RequestAttachment): string {
  const parts = [TYPE_LABELS[attachment.mediaType], formatAttachmentSize(attachment.size)];
  if (attachment.kind === "text" && attachment.truncated) parts.push("일부만 읽음");
  return parts.join(" · ");
}
