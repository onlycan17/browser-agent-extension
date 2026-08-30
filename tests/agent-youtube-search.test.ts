import { describe, expect, it, vi } from "vitest";
import {
  AgentToolExecutor,
  parseToolCallArguments,
  toolCallSignature,
} from "../src/background/agent-tools";
import { ApprovalManager } from "../src/background/approval-manager";
import { SafetyPolicy } from "../src/background/safety-policy";
import type { ToolCall } from "../src/shared/llm";
import type { PageSnapshot } from "../src/shared/page";

const snapshot: PageSnapshot = {
  generation: 1,
  url: "https://www.youtube.com/watch?v=aircAruvnKk",
  title: "Example",
  viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
  visibleText: "Example",
  elements: [],
};

function searchCall(query = "browser agents", limit = 5): ToolCall {
  return {
    id: "call-search",
    type: "function",
    function: { name: "youtube_search", arguments: `{"query":"${query}","limit":${limit}}` },
  };
}

describe("youtube_search tool", () => {
  it("parses bounded arguments and produces a stable signature", () => {
    expect(parseToolCallArguments(searchCall())).toMatchObject({
      name: "youtube_search",
      query: "browser agents",
      limit: 5,
    });
    expect(toolCallSignature(searchCall("a"))).toBe(toolCallSignature(searchCall("a")));
    expect(toolCallSignature(searchCall("a", 5))).not.toBe(toolCallSignature(searchCall("a", 6)));
  });

  it("rejects out-of-range arguments", () => {
    expect(
      parseToolCallArguments({
        id: "x",
        type: "function",
        function: { name: "youtube_search", arguments: '{"query":"","limit":5}' },
      }),
    ).toBeNull();
    expect(
      parseToolCallArguments({
        id: "x",
        type: "function",
        function: { name: "youtube_search", arguments: '{"query":"a","limit":11}' },
      }),
    ).toBeNull();
  });

  it("is allowed by the safety policy without user approval", () => {
    const decision = new SafetyPolicy().evaluate({ action: "youtube_search" });

    expect(decision).toEqual({ outcome: "allow" });
  });

  it("returns search results through the tool message data field", async () => {
    const actions = {
      executeAction: vi.fn(() =>
        Promise.resolve({
          message: "Found 2 videos.",
          data: {
            results: [
              {
                videoId: "abc12345678",
                url: "https://www.youtube.com/watch?v=abc12345678",
                title: "One",
              },
              {
                videoId: "def23456789",
                url: "https://www.youtube.com/watch?v=def23456789",
                title: "Two",
              },
            ],
          },
        }),
      ),
    };
    const executor = new AgentToolExecutor(
      actions,
      new SafetyPolicy(),
      new ApprovalManager(),
      () => undefined,
    );

    const result = await executor.execute(
      searchCall(),
      snapshot,
      "run-search",
      new AbortController().signal,
    );

    expect(result.failed).toBe(false);
    expect(actions.executeAction).toHaveBeenCalledWith(
      { type: "YOUTUBE_SEARCH", payload: { query: "browser agents", limit: 5 } },
      "run-search",
      expect.anything(),
    );
    const payload = JSON.parse(result.message.content) as {
      ok: boolean;
      data: { results: unknown[] };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.results).toHaveLength(2);
  });
});
