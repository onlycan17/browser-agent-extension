import {
  MAX_ATTACHMENT_COUNT,
  MAX_EXTRACTED_TEXT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_PDF_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MAX_TOTAL_EXTRACTED_TEXT_CHARS,
  type ImageMediaType,
  type RequestAttachment,
  type TextAttachmentMediaType,
} from "../shared/attachments";

export type AttachmentReadErrorCode =
  | "UNSUPPORTED_ATTACHMENT"
  | "INVALID_ATTACHMENT"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_READ_FAILED";

export class AttachmentReadError extends Error {
  constructor(
    readonly code: AttachmentReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AttachmentReadError";
  }
}

export interface PdfExtractionResult {
  text: string;
  truncated: boolean;
}

interface AttachmentReaderDependencies {
  extractPdf?: (
    data: ArrayBuffer,
    characterLimit: number,
    signal: AbortSignal,
  ) => Promise<PdfExtractionResult>;
}

interface FileDescriptor {
  kind: "image" | "text" | "pdf";
  mediaType: ImageMediaType | TextAttachmentMediaType;
  acceptedTypes: readonly string[];
  maximumBytes: number;
}

const FILE_DESCRIPTORS: Record<string, FileDescriptor> = {
  png: imageDescriptor("image/png"),
  jpg: imageDescriptor("image/jpeg"),
  jpeg: imageDescriptor("image/jpeg"),
  webp: imageDescriptor("image/webp"),
  gif: imageDescriptor("image/gif"),
  txt: textDescriptor("text/plain", ["text/plain"]),
  md: textDescriptor("text/markdown", ["text/markdown", "text/plain"]),
  csv: textDescriptor("text/csv", ["text/csv", "text/plain"]),
  json: textDescriptor("application/json", ["application/json", "text/plain"]),
  html: textDescriptor("text/html", ["text/html", "text/plain"]),
  htm: textDescriptor("text/html", ["text/html", "text/plain"]),
  xml: textDescriptor("application/xml", ["application/xml", "text/xml", "text/plain"]),
  pdf: {
    kind: "pdf",
    mediaType: "application/pdf",
    acceptedTypes: ["application/pdf"],
    maximumBytes: MAX_PDF_BYTES,
  },
};

function imageDescriptor(mediaType: ImageMediaType): FileDescriptor {
  return { kind: "image", mediaType, acceptedTypes: [mediaType], maximumBytes: MAX_IMAGE_BYTES };
}

function textDescriptor(
  mediaType: TextAttachmentMediaType,
  acceptedTypes: readonly string[],
): FileDescriptor {
  return { kind: "text", mediaType, acceptedTypes, maximumBytes: MAX_TEXT_FILE_BYTES };
}

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

function descriptorFor(file: File): FileDescriptor {
  const descriptor = FILE_DESCRIPTORS[fileExtension(file.name)];
  if (
    descriptor === undefined ||
    (file.type !== "" && !descriptor.acceptedTypes.includes(file.type))
  ) {
    throw new AttachmentReadError(
      "UNSUPPORTED_ATTACHMENT",
      `${file.name} 파일 형식은 지원하지 않습니다.`,
    );
  }
  if (file.size <= 0) {
    throw new AttachmentReadError("INVALID_ATTACHMENT", `${file.name} 파일이 비어 있습니다.`);
  }
  if (file.size > descriptor.maximumBytes) {
    throw new AttachmentReadError(
      "ATTACHMENT_TOO_LARGE",
      `${file.name} 파일이 형식별 크기 제한을 초과했습니다.`,
    );
  }
  return descriptor;
}

function readBytes(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
    };
    const finish = () => {
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.onerror = () => {
      finish();
      reject(
        new AttachmentReadError("ATTACHMENT_READ_FAILED", `${file.name} 파일을 읽지 못했습니다.`),
      );
    };
    reader.onabort = () => {
      finish();
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"),
      );
    };
    reader.onload = () => {
      finish();
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else
        reject(
          new AttachmentReadError("ATTACHMENT_READ_FAILED", `${file.name} 파일을 읽지 못했습니다.`),
        );
    };
    reader.readAsArrayBuffer(file);
  });
}

function startsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function validImageSignature(bytes: Uint8Array, mediaType: ImageMediaType): boolean {
  if (mediaType === "image/png") return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  if (mediaType === "image/jpeg") return startsWith(bytes, [255, 216, 255]);
  if (mediaType === "image/gif") {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    return signature === "GIF87a" || signature === "GIF89a";
  }
  return (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
  }
  return btoa(chunks.join(""));
}

function imageAttachment(
  file: File,
  descriptor: FileDescriptor,
  data: ArrayBuffer,
): RequestAttachment {
  const mediaType = descriptor.mediaType as ImageMediaType;
  const bytes = new Uint8Array(data);
  if (!validImageSignature(bytes, mediaType)) {
    throw new AttachmentReadError(
      "INVALID_ATTACHMENT",
      `${file.name} 이미지 내용이 확장자와 일치하지 않습니다.`,
    );
  }
  return {
    kind: "image",
    name: file.name,
    mediaType,
    dataUrl: `data:${mediaType};base64,${base64(bytes)}`,
    size: file.size,
  };
}

function decodeText(file: File, data: ArrayBuffer, characterLimit: number): RequestAttachment {
  let value: string;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    throw new AttachmentReadError(
      "INVALID_ATTACHMENT",
      `${file.name} 파일은 유효한 UTF-8 텍스트가 아닙니다.`,
    );
  }
  const text = value.slice(0, characterLimit);
  if (text.length === 0) {
    throw new AttachmentReadError(
      "INVALID_ATTACHMENT",
      `${file.name} 파일에 읽을 텍스트가 없습니다.`,
    );
  }
  const descriptor = FILE_DESCRIPTORS[fileExtension(file.name)];
  if (descriptor === undefined) throw new AttachmentReadError("UNSUPPORTED_ATTACHMENT", file.name);
  return {
    kind: "text",
    name: file.name,
    mediaType: descriptor.mediaType as TextAttachmentMediaType,
    text,
    size: file.size,
    truncated: value.length > text.length,
  };
}

async function defaultPdfExtractor(
  data: ArrayBuffer,
  characterLimit: number,
  signal: AbortSignal,
): Promise<PdfExtractionResult> {
  const module = await import("./pdf-text-extractor");
  return module.extractPdfText(data, characterLimit, signal);
}

async function pdfAttachment(
  file: File,
  data: ArrayBuffer,
  characterLimit: number,
  signal: AbortSignal,
  extractPdf: NonNullable<AttachmentReaderDependencies["extractPdf"]>,
): Promise<RequestAttachment> {
  if (!startsWith(new Uint8Array(data), [37, 80, 68, 70, 45])) {
    throw new AttachmentReadError(
      "INVALID_ATTACHMENT",
      `${file.name} 파일은 유효한 PDF가 아닙니다.`,
    );
  }
  let result: PdfExtractionResult;
  try {
    result = await extractPdf(data, characterLimit, signal);
  } catch (error: unknown) {
    if (signal.aborted) throw error;
    throw new AttachmentReadError("ATTACHMENT_READ_FAILED", `${file.name} PDF를 읽지 못했습니다.`);
  }
  const text = result.text.trim();
  if (text.length === 0) {
    throw new AttachmentReadError(
      "INVALID_ATTACHMENT",
      `${file.name} PDF에서 텍스트를 찾지 못했습니다. 스캔 PDF OCR은 지원하지 않습니다.`,
    );
  }
  return {
    kind: "text",
    name: file.name,
    mediaType: "application/pdf",
    text,
    size: file.size,
    truncated: result.truncated,
  };
}

export async function readSelectedAttachments(
  files: readonly File[],
  dependencies: AttachmentReaderDependencies = {},
  signal: AbortSignal = new AbortController().signal,
): Promise<RequestAttachment[]> {
  if (files.length > MAX_ATTACHMENT_COUNT) {
    throw new AttachmentReadError(
      "ATTACHMENT_TOO_LARGE",
      `첨부파일은 최대 ${String(MAX_ATTACHMENT_COUNT)}개까지 선택할 수 있습니다.`,
    );
  }
  const descriptors = files.map(descriptorFor);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new AttachmentReadError(
      "ATTACHMENT_TOO_LARGE",
      "첨부파일 전체 크기는 10MB 이하여야 합니다.",
    );
  }
  const attachments: RequestAttachment[] = [];
  let remainingText = MAX_TOTAL_EXTRACTED_TEXT_CHARS;
  for (const [index, file] of files.entries()) {
    signal.throwIfAborted();
    const descriptor = descriptors[index];
    if (descriptor === undefined) continue;
    const data = await readBytes(file, signal);
    if (descriptor.kind === "image") {
      attachments.push(imageAttachment(file, descriptor, data));
      continue;
    }
    const limit = Math.min(MAX_EXTRACTED_TEXT_CHARS, remainingText);
    if (limit === 0) {
      throw new AttachmentReadError(
        "ATTACHMENT_TOO_LARGE",
        "첨부파일의 추출 텍스트가 전체 제한을 초과했습니다.",
      );
    }
    const attachment =
      descriptor.kind === "pdf"
        ? await pdfAttachment(
            file,
            data,
            limit,
            signal,
            dependencies.extractPdf ?? defaultPdfExtractor,
          )
        : decodeText(file, data, limit);
    attachments.push(attachment);
    remainingText -= attachment.kind === "text" ? attachment.text.length : 0;
  }
  return attachments;
}
