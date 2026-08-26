import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import type { PdfExtractionResult } from "./attachment-reader";

function runtimeUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

function normalizePageText(value: string): string {
  return value
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

async function extractPage(document: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await document.getPage(pageNumber);
  const content = await page.getTextContent();
  const parts = content.items.flatMap((item) => {
    if (!("str" in item) || item.str.length === 0) return [];
    return [`${item.str}${item.hasEOL ? "\n" : " "}`];
  });
  page.cleanup();
  return normalizePageText(parts.join(""));
}

async function collectText(
  document: PDFDocumentProxy,
  characterLimit: number,
  signal: AbortSignal,
): Promise<PdfExtractionResult> {
  const pages: string[] = [];
  let length = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    signal.throwIfAborted();
    const text = await extractPage(document, pageNumber);
    if (text.length === 0) continue;
    pages.push(text);
    length += text.length + 2;
    if (length > characterLimit) {
      return { text: pages.join("\n\n").slice(0, characterLimit), truncated: true };
    }
  }
  return { text: pages.join("\n\n"), truncated: false };
}

export async function extractPdfText(
  data: ArrayBuffer,
  characterLimit: number,
  signal: AbortSignal,
): Promise<PdfExtractionResult> {
  signal.throwIfAborted();
  GlobalWorkerOptions.workerSrc = runtimeUrl("pdf.worker.mjs");
  const loading = getDocument({
    data: new Uint8Array(data),
    cMapUrl: runtimeUrl("cmaps/"),
    cMapPacked: true,
    disableFontFace: true,
    enableXfa: false,
    stopAtErrors: true,
  });
  let destroying: Promise<void> | null = null;
  const destroy = () => (destroying ??= loading.destroy());
  const abort = () => {
    void destroy();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await collectText(await loading.promise, characterLimit, signal);
  } finally {
    signal.removeEventListener("abort", abort);
    await destroy();
  }
}
