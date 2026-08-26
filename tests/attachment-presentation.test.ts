import { describe, expect, it } from "vitest";
import { attachmentSummary, formatAttachmentSize } from "../src/sidepanel/attachment-presentation";

describe("attachment presentation", () => {
  it.each([
    { bytes: 512, expected: "512 B" },
    { bytes: 1536, expected: "1.5 KB" },
    { bytes: 2 * 1024 * 1024, expected: "2.0 MB" },
  ])("formats $bytes bytes", ({ bytes, expected }) => {
    expect(formatAttachmentSize(bytes)).toBe(expected);
  });

  it("shows type, size, and truncation state", () => {
    expect(
      attachmentSummary({
        kind: "text",
        name: "report.pdf",
        mediaType: "application/pdf",
        text: "excerpt",
        size: 2048,
        truncated: true,
      }),
    ).toBe("PDF · 2.0 KB · 일부만 읽음");
  });
});
