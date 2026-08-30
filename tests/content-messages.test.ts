import { describe, expect, it } from "vitest";
import {
  parseActionResponse,
  parseContentErrorResponse,
  parseContentRequest,
  parseTranscriptChunkResponse,
} from "../src/shared/content-messages";
const expected = {
  id: "e-1-1",
  tag: "button",
  role: "button",
  name: "Submit",
  disabled: false,
  bounds: { x: 10, y: 10, width: 100, height: 30 },
};

describe("content message parser", () => {
  it("accepts an action guarded by the observed element state", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-1", expected },
      }),
    ).toEqual({
      id: "request-1",
      type: "PAGE_CLICK",
      payload: { generation: 1, elementId: "e-1-1", expected },
    });
  });

  it("rejects an unguarded element action", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-1" },
      }),
    ).toBeNull();
  });

  it("accepts guarded text input metadata without a field value", () => {
    const input = {
      ...expected,
      tag: "input",
      role: "textbox",
      name: "Code",
      inputType: "text",
      autocomplete: "one-time-code",
    };

    expect(
      parseContentRequest({
        id: "request-2",
        type: "PAGE_TYPE_TEXT",
        payload: {
          generation: 1,
          elementId: "e-1-1",
          text: "123456",
          replace: true,
          expected: input,
        },
      }),
    ).toMatchObject({
      type: "PAGE_TYPE_TEXT",
      payload: { expected: { autocomplete: "one-time-code" } },
    });
  });

  it("rejects a guard for a different element", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-2", expected },
      }),
    ).toBeNull();
  });

  it("rejects extra untrusted guard properties", () => {
    expect(
      parseContentRequest({
        id: "request-1",
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1-1", expected: { ...expected, value: "secret" } },
      }),
    ).toBeNull();
  });

  it("accepts only guarded form and nested-scroll actions", () => {
    const select = {
      ...expected,
      tag: "select",
      role: "combobox",
      name: "Region",
      options: [
        { label: "Seoul", selected: true, disabled: false },
        { label: "Busan", selected: false, disabled: false },
      ],
    };
    expect(
      parseContentRequest({
        id: "select-1",
        type: "PAGE_SELECT_OPTION",
        payload: {
          generation: 1,
          elementId: "e-1-1",
          optionLabel: "Busan",
          expected: select,
        },
      }),
    ).toMatchObject({ type: "PAGE_SELECT_OPTION", payload: { optionLabel: "Busan" } });
    expect(
      parseContentRequest({
        id: "check-1",
        type: "PAGE_SET_CHECKED",
        payload: { generation: 1, elementId: "e-1-1", checked: true, expected },
      }),
    ).toMatchObject({ type: "PAGE_SET_CHECKED", payload: { checked: true } });
    expect(
      parseContentRequest({
        id: "scroll-1",
        type: "PAGE_SCROLL_ELEMENT",
        payload: {
          generation: 1,
          elementId: "e-1-1",
          direction: "down",
          amount: 500,
          expected,
        },
      }),
    ).toMatchObject({ type: "PAGE_SCROLL_ELEMENT", payload: { amount: 500 } });
    expect(
      parseContentRequest({
        id: "select-unsafe",
        type: "PAGE_SELECT_OPTION",
        payload: {
          generation: 1,
          elementId: "e-1-1",
          optionLabel: "x".repeat(301),
          expected: select,
        },
      }),
    ).toBeNull();
  });

  it("preserves page settlement status on successful actions", () => {
    expect(
      parseActionResponse(
        { id: "action-1", ok: true, data: { message: "Clicked.", pageSettled: false } },
        "action-1",
      ),
    ).toEqual({ message: "Clicked.", pageSettled: false });
  });

  it("preserves a validated structured content error", () => {
    expect(
      parseContentErrorResponse(
        {
          id: "action-1",
          ok: false,
          error: {
            code: "STALE_ELEMENT",
            message: "The page changed; observe it again.",
            retryable: true,
          },
        },
        "action-1",
      ),
    ).toEqual({
      code: "STALE_ELEMENT",
      message: "The page changed; observe it again.",
      retryable: true,
    });
    expect(
      parseContentErrorResponse(
        {
          id: "action-1",
          ok: false,
          error: { code: "STALE_ELEMENT", message: "x".repeat(501), retryable: true },
        },
        "action-1",
      ),
    ).toBeNull();
  });

  it("accepts a bounded youtube search action", () => {
    expect(
      parseContentRequest({
        id: "r-1",
        type: "YOUTUBE_SEARCH",
        payload: { query: "  browser agents  ", limit: 5 },
      }),
    ).toEqual({
      id: "r-1",
      type: "YOUTUBE_SEARCH",
      payload: { query: "browser agents", limit: 5 },
    });
  });

  it("rejects an unbounded youtube search action", () => {
    expect(
      parseContentRequest({
        id: "r-2",
        type: "YOUTUBE_SEARCH",
        payload: { query: "x".repeat(201), limit: 5 },
      }),
    ).toBeNull();
    expect(
      parseContentRequest({
        id: "r-3",
        type: "YOUTUBE_SEARCH",
        payload: { query: "agents", limit: 11 },
      }),
    ).toBeNull();
  });

  it("accepts a bounded transcript chunk request", () => {
    expect(
      parseContentRequest({
        id: "transcript-1",
        type: "TRANSCRIPT_READ_CHUNK",
        payload: { cursor: 12, maxChars: 8_000, afterSegmentKey: "12ab34cd" },
      }),
    ).toEqual({
      id: "transcript-1",
      type: "TRANSCRIPT_READ_CHUNK",
      payload: { cursor: 12, maxChars: 8_000, afterSegmentKey: "12ab34cd" },
    });
    expect(
      parseContentRequest({
        id: "transcript-2",
        type: "TRANSCRIPT_READ_CHUNK",
        payload: { cursor: -1, maxChars: 8_000 },
      }),
    ).toBeNull();
  });

  it("validates transcript chunk responses before they reach the background", () => {
    const response = {
      id: "transcript-1",
      ok: true,
      data: {
        available: true,
        cursor: 0,
        nextCursor: 2,
        done: false,
        startTime: "00:00",
        endTime: "00:30",
        contextText: "",
        text: "[00:00] Intro\n[00:30] Topic",
        segmentCount: 2,
        totalSegments: 3,
        lastSegmentKey: "12ab34cd",
      },
    };

    expect(parseTranscriptChunkResponse(response, "transcript-1")).toEqual(response.data);
    expect(
      parseTranscriptChunkResponse(
        { ...response, data: { ...response.data, text: "x".repeat(8_001) } },
        "transcript-1",
      ),
    ).toBeNull();
  });
});
