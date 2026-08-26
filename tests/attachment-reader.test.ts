import { describe, expect, it, vi } from "vitest";
import {
  AttachmentReadError,
  readSelectedAttachments,
  type PdfExtractionResult,
} from "../src/sidepanel/attachment-reader";

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function file(parts: BlobPart[], name: string, type: string): File {
  return new File(parts, name, { type });
}

describe("attachment reader", () => {
  it("reads a signature-validated image as a data URL", async () => {
    const [attachment] = await readSelectedAttachments([
      file([pngBytes], "diagram.png", "image/png"),
    ]);

    expect(attachment).toMatchObject({
      kind: "image",
      name: "diagram.png",
      mediaType: "image/png",
      size: pngBytes.byteLength,
    });
    expect(attachment?.kind === "image" ? attachment.dataUrl : "").toMatch(
      /^data:image\/png;base64,/u,
    );
  });

  it("reads UTF-8 text and marks bounded truncation", async () => {
    const source = "가".repeat(32_010);
    const [attachment] = await readSelectedAttachments([
      file([source], "notes.md", "text/markdown"),
    ]);

    expect(attachment).toMatchObject({
      kind: "text",
      name: "notes.md",
      mediaType: "text/markdown",
      truncated: true,
    });
    expect(attachment?.kind === "text" ? attachment.text : "").toHaveLength(32_000);
  });

  it("uses bounded PDF extraction without sending raw PDF bytes", async () => {
    const extractPdf = vi.fn<(data: ArrayBuffer, limit: number) => Promise<PdfExtractionResult>>();
    extractPdf.mockResolvedValue({ text: "Page one\nPage two", truncated: false });
    const pdf = file(["%PDF-1.7"], "report.pdf", "application/pdf");

    const [attachment] = await readSelectedAttachments([pdf], { extractPdf });

    expect(extractPdf).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      32_000,
      expect.any(AbortSignal),
    );
    expect(attachment).toEqual({
      kind: "text",
      name: "report.pdf",
      mediaType: "application/pdf",
      text: "Page one\nPage two",
      size: pdf.size,
      truncated: false,
    });
  });

  it.each([
    {
      label: "MIME and extension mismatch",
      input: file([pngBytes], "diagram.jpg", "image/png"),
      code: "UNSUPPORTED_ATTACHMENT",
    },
    {
      label: "invalid image signature",
      input: file(["not a png"], "diagram.png", "image/png"),
      code: "INVALID_ATTACHMENT",
    },
    {
      label: "unsupported binary",
      input: file(["binary"], "archive.zip", "application/zip"),
      code: "UNSUPPORTED_ATTACHMENT",
    },
  ])("rejects $label", async ({ input, code }) => {
    await expect(readSelectedAttachments([input])).rejects.toMatchObject({ code });
  });

  it.each(["corrupt", "password protected"])(
    "maps %s PDF parser failures without exposing parser details",
    async (reason) => {
      const extractPdf = () => Promise.reject(new Error(`${reason}: secret parser detail`));
      const request = readSelectedAttachments(
        [file(["%PDF-1.7"], "report.pdf", "application/pdf")],
        { extractPdf },
      );

      await expect(request).rejects.toMatchObject({
        code: "ATTACHMENT_READ_FAILED",
        message: "report.pdf PDF를 읽지 못했습니다.",
      });
      await expect(request).rejects.not.toThrow("secret parser detail");
    },
  );

  it("rejects PDFs without extractable text", async () => {
    const extractPdf = () => Promise.resolve({ text: "", truncated: false });

    await expect(
      readSelectedAttachments([file(["%PDF"], "scan.pdf", "application/pdf")], { extractPdf }),
    ).rejects.toBeInstanceOf(AttachmentReadError);
  });
});
