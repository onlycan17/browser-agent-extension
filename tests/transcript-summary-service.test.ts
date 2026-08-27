import { describe, expect, it, vi } from "vitest";
import {
  TranscriptSummaryError,
  TranscriptSummaryService,
} from "../src/background/transcript-summary-service";
import type { ChatRequest } from "../src/shared/llm";
import type { TranscriptChunkResult } from "../src/shared/transcript";
import { DEFAULT_LOCAL_MODEL, LOCAL_BASE_URL } from "../src/shared/settings";

const settings = {
  provider: "local" as const,
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
};

function chunk(
  cursor: number,
  text: string,
  done: boolean,
  totalSegments = 2,
): TranscriptChunkResult {
  return {
    available: true,
    cursor,
    nextCursor: cursor + 1,
    done,
    startTime: `00:0${String(cursor)}`,
    endTime: `00:0${String(cursor)}`,
    contextText: cursor === 0 ? "" : `[00:0${String(cursor - 1)}] overlap`,
    text,
    segmentCount: 1,
    totalSegments,
    lastSegmentKey: `segment-${String(cursor)}`,
  };
}

function systemText(request: ChatRequest): string {
  const message = request.messages[0];
  return message?.role === "system" ? message.content : "";
}

describe("TranscriptSummaryService", () => {
  it("summarizes chunks separately and synthesizes only their summaries", async () => {
    const chunks = [
      chunk(0, "[00:00] RAW_SECRET_ALPHA", false),
      chunk(1, "[00:01] RAW_SECRET_BETA", true),
    ];
    const readTranscriptChunk = vi.fn((_runId, cursor: number) => {
      const value = chunks[cursor];
      if (value === undefined) throw new Error("Unexpected transcript cursor.");
      return Promise.resolve(value);
    });
    const requests: ChatRequest[] = [];
    let chunkSummary = 0;
    const complete = vi.fn((_settings, request: ChatRequest) => {
      requests.push(request);
      const system = request.messages[0]?.content;
      if (typeof system === "string" && system.includes("one transcript chunk")) {
        chunkSummary += 1;
        return Promise.resolve({
          role: "assistant" as const,
          content: `구간 요약 ${String(chunkSummary)}`,
        });
      }
      return Promise.resolve({ role: "assistant" as const, content: "전체 영상 요약" });
    });
    const progress = vi.fn();
    const service = new TranscriptSummaryService({ readTranscriptChunk }, { complete });

    const result = await service.summarize(
      settings,
      "run-1",
      "핵심 논지를 한국어로 정리",
      new AbortController().signal,
      progress,
    );

    expect(result).toEqual({
      summary: "전체 영상 요약",
      chunks: 2,
      startTime: "00:00",
      endTime: "00:01",
      truncated: false,
    });
    expect(readTranscriptChunk).toHaveBeenNthCalledWith(
      1,
      "run-1",
      0,
      8_000,
      "",
      expect.any(AbortSignal),
    );
    expect(readTranscriptChunk).toHaveBeenNthCalledWith(
      2,
      "run-1",
      1,
      8_000,
      "segment-0",
      expect.any(AbortSignal),
    );
    expect(progress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(progress).toHaveBeenNthCalledWith(2, 2, 2);
    const finalRequest = requests.at(-1);
    expect(JSON.stringify(finalRequest)).toContain("구간 요약 1");
    expect(JSON.stringify(finalRequest)).toContain("구간 요약 2");
    expect(JSON.stringify(finalRequest)).not.toContain("RAW_SECRET_ALPHA");
    expect(JSON.stringify(finalRequest)).not.toContain("RAW_SECRET_BETA");
  });

  it("hierarchically merges many chunk summaries in bounded groups", async () => {
    const readTranscriptChunk = vi.fn((_runId, cursor: number) =>
      Promise.resolve(chunk(cursor, `[00:0${String(cursor)}] source`, cursor === 6, 7)),
    );
    const requestKinds: string[] = [];
    const complete = vi.fn((_settings, request: ChatRequest) => {
      const system = systemText(request);
      const kind = system.includes("one transcript chunk")
        ? "chunk"
        : system.includes("Create a user-ready")
          ? "final"
          : "merge";
      requestKinds.push(kind);
      return Promise.resolve({ role: "assistant" as const, content: `${kind} summary` });
    });
    const service = new TranscriptSummaryService({ readTranscriptChunk }, { complete });

    await service.summarize(settings, "run-many", "전체 흐름", new AbortController().signal);

    expect(requestKinds.filter((kind) => kind === "chunk")).toHaveLength(7);
    expect(requestKinds.filter((kind) => kind === "merge")).toHaveLength(2);
    expect(requestKinds.at(-1)).toBe("final");
  });

  it("marks a partial summary when continuation becomes unavailable", async () => {
    const readTranscriptChunk = vi
      .fn()
      .mockResolvedValueOnce(chunk(0, "[00:00] unstable end", false, 1))
      .mockResolvedValueOnce({
        available: false as const,
        reason: "The transcript cursor is no longer available.",
      });
    const complete = vi.fn((_settings, request: ChatRequest) =>
      Promise.resolve({
        role: "assistant" as const,
        content: systemText(request).includes("one transcript chunk")
          ? "확인된 구간 요약"
          : "부분 영상 요약",
      }),
    );
    const service = new TranscriptSummaryService({ readTranscriptChunk }, { complete });

    const result = await service.summarize(
      settings,
      "run-unstable-end",
      "",
      new AbortController().signal,
    );

    expect(result).toMatchObject({ chunks: 1, truncated: true, summary: "부분 영상 요약" });
    expect(readTranscriptChunk).toHaveBeenCalledTimes(2);
  });

  it("fails clearly when an opened transcript is unavailable", async () => {
    const complete = vi.fn();
    const service = new TranscriptSummaryService(
      {
        readTranscriptChunk: () =>
          Promise.resolve({
            available: false as const,
            reason: "No opened transcript segments were found.",
          }),
      },
      { complete },
    );

    await expect(
      service.summarize(settings, "run-missing", "", new AbortController().signal),
    ).rejects.toEqual(
      new TranscriptSummaryError(
        "TRANSCRIPT_UNAVAILABLE",
        "No opened transcript segments were found.",
      ),
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects an empty chunk summary instead of silently losing content", async () => {
    const service = new TranscriptSummaryService(
      { readTranscriptChunk: () => Promise.resolve(chunk(0, "[00:00] content", true, 1)) },
      { complete: () => Promise.resolve({ role: "assistant" as const, content: "  " }) },
    );

    await expect(
      service.summarize(settings, "run-empty", "", new AbortController().signal),
    ).rejects.toMatchObject({ code: "TRANSCRIPT_SUMMARY_FAILED" });
  });

  it("caps exceptionally long transcripts and marks the final summary as partial", async () => {
    const readTranscriptChunk = vi.fn((_runId, cursor: number) =>
      Promise.resolve(chunk(cursor, `[00:${String(cursor)}] source`, false, 100)),
    );
    const finalRequests: ChatRequest[] = [];
    const complete = vi.fn((_settings, request: ChatRequest) => {
      if (systemText(request).includes("Create a user-ready")) {
        finalRequests.push(request);
        return Promise.resolve({ role: "assistant" as const, content: "부분 요약" });
      }
      return Promise.resolve({ role: "assistant" as const, content: "중간 요약" });
    });
    const service = new TranscriptSummaryService({ readTranscriptChunk }, { complete });

    const result = await service.summarize(
      settings,
      "run-capped",
      "",
      new AbortController().signal,
    );

    expect(result).toMatchObject({ chunks: 64, truncated: true, summary: "부분 요약" });
    expect(readTranscriptChunk).toHaveBeenCalledTimes(64);
    const finalUserMessage = finalRequests[0]?.messages[1];
    const finalData =
      finalUserMessage?.role === "user" && typeof finalUserMessage.content === "string"
        ? (JSON.parse(finalUserMessage.content) as Record<string, unknown>)
        : {};
    expect(finalData.truncated).toBe(true);
  });

  it("stops before reading transcript data when the run is already cancelled", async () => {
    const readTranscriptChunk = vi.fn();
    const complete = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const service = new TranscriptSummaryService({ readTranscriptChunk }, { complete });

    await expect(
      service.summarize(settings, "run-cancelled", "", controller.signal),
    ).rejects.toThrow();
    expect(readTranscriptChunk).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("stops promptly when cancellation occurs during a model summary", async () => {
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const controller = new AbortController();
    const service = new TranscriptSummaryService(
      { readTranscriptChunk: () => Promise.resolve(chunk(0, "[00:00] content", true, 1)) },
      {
        complete: () => {
          markStarted?.();
          return new Promise(() => undefined);
        },
      },
    );

    const running = service.summarize(settings, "run-cancelled-model", "", controller.signal);
    await started;
    controller.abort();
    const outcome = await Promise.race([
      running.then(
        () => "resolved",
        () => "aborted",
      ),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("timeout");
        }, 50);
      }),
    ]);

    expect(outcome).toBe("aborted");
  });
});
