import { beforeEach, describe, expect, it, vi } from "vitest";

interface LoadingTaskFixture {
  promise: Promise<{
    numPages: number;
    getPage(pageNumber: number): Promise<{
      getTextContent(): Promise<{ items: { str: string; hasEOL: boolean }[] }>;
      cleanup(): void;
    }>;
  }>;
  destroy(): Promise<void>;
}

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn<(options: unknown) => LoadingTaskFixture>(),
  workerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => ({
  getDocument: pdf.getDocument,
  GlobalWorkerOptions: pdf.workerOptions,
}));

import { extractPdfText } from "../src/sidepanel/pdf-text-extractor";

describe("PDF text extractor", () => {
  beforeEach(() => {
    pdf.getDocument.mockReset();
    pdf.workerOptions.workerSrc = "";
    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => `chrome-extension://extension/${path}` },
    });
  });

  it("uses packaged worker/CMaps, preserves page order, and destroys the document", async () => {
    const destroy = vi.fn(() => Promise.resolve());
    const cleanup = vi.fn();
    pdf.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: (pageNumber) =>
          Promise.resolve({
            getTextContent: () =>
              Promise.resolve({ items: [{ str: `Page ${String(pageNumber)}`, hasEOL: true }] }),
            cleanup,
          }),
      }),
      destroy,
    });

    const result = await extractPdfText(
      new Uint8Array([1, 2, 3]).buffer,
      100,
      new AbortController().signal,
    );

    expect(result).toEqual({ text: "Page 1\n\nPage 2", truncated: false });
    expect(pdf.workerOptions.workerSrc).toBe("chrome-extension://extension/pdf.worker.mjs");
    expect(pdf.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        cMapUrl: "chrome-extension://extension/cmaps/",
        cMapPacked: true,
        disableFontFace: true,
        enableXfa: false,
        stopAtErrors: true,
      }),
    );
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("rejects an already-aborted extraction before loading PDF.js", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(extractPdfText(new ArrayBuffer(1), 100, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(pdf.getDocument).not.toHaveBeenCalled();
  });
});
