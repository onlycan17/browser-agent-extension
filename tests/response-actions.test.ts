import { describe, expect, it, vi } from "vitest";
import {
  copyResponse,
  ResponseActionError,
  shareResponse,
  type ResponseActionEnvironment,
} from "../src/sidepanel/response-actions";

function environment(
  writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(),
  share?: (data: ShareData) => Promise<void>,
): ResponseActionEnvironment {
  return share ? { clipboard: { writeText }, share } : { clipboard: { writeText } };
}

describe("Side Panel response actions", () => {
  it("copies the unformatted response text", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();

    await expect(copyResponse("**최종 답변**", environment(writeText))).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("**최종 답변**");
  });

  it("uses the native share sheet when available", async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue();

    await expect(
      shareResponse("분석 결과", "답변 본문", environment(undefined, share)),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ title: "분석 결과", text: "답변 본문" });
  });

  it("copies the response when native sharing is unavailable", async () => {
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue();

    await expect(shareResponse("분석 결과", "답변 본문", environment(writeText))).resolves.toBe(
      "copied",
    );
    expect(writeText).toHaveBeenCalledWith("답변 본문");
  });

  it("reports a cancelled native share without treating it as a failure", async () => {
    const share = vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockRejectedValue(new DOMException("Cancelled", "AbortError"));

    await expect(
      shareResponse("분석 결과", "답변 본문", environment(undefined, share)),
    ).resolves.toBe("cancelled");
  });

  it("converts clipboard and share failures into user-safe errors", async () => {
    const writeText = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValue(new Error("denied"));
    const share = vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockRejectedValue(new Error("failed"));

    await expect(copyResponse("답변", environment(writeText))).rejects.toEqual(
      new ResponseActionError("답변을 클립보드에 복사하지 못했습니다."),
    );
    await expect(shareResponse("제목", "답변", environment(undefined, share))).rejects.toEqual(
      new ResponseActionError("답변 공유를 완료하지 못했습니다."),
    );
  });
});
