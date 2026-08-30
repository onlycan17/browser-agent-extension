import type { PageActionRequest, PageActionResult } from "../shared/actions";
import { parseContentRequest, type ContentResponse } from "../shared/content-messages";
import type { PageSnapshot } from "../shared/page";
import type { TranscriptChunkResult } from "../shared/transcript";
import { ElementRegistry } from "./element-registry";
import { ActionExecutionError, PageActionExecutor } from "./page-action-executor";
import { PageObserver } from "./page-observer";
import { waitForPageSettled } from "./page-settler";
import { readStableTranscriptChunk, readTranscriptChunk } from "./transcript-reader";
import { handleYouTubeSearch, readHttpTranscriptChunk } from "./youtube-http";
import { readVttTranscriptChunk } from "./vtt-transcript";
import { YouTubeAdapter, YouTubeError } from "./youtube-adapter";

const registry = new ElementRegistry();
const observer = new PageObserver(registry);
const actions = new PageActionExecutor(registry);
const youtube = new YouTubeAdapter();

type ContentData = PageSnapshot | PageActionResult | TranscriptChunkResult | { ready: true };

function errorResponse(id: string, code: string, message: string): ContentResponse<never> {
  return { id, ok: false, error: { code, message, retryable: false } };
}

async function executeAction(request: PageActionRequest): Promise<PageActionResult> {
  if (request.type === "YOUTUBE_SEARCH") {
    try {
      return await handleYouTubeSearch(request.payload);
    } catch (error: unknown) {
      throw new ActionExecutionError(
        "YOUTUBE_SEARCH_FAILED",
        error instanceof Error ? error.message : "The YouTube search request failed.",
      );
    }
  }
  if (request.type === "PAGE_CLICK") {
    return actions.click(
      request.payload.generation,
      request.payload.elementId,
      request.payload.expected,
    );
  }
  if (request.type === "PAGE_TYPE_TEXT") {
    return actions.typeText(
      request.payload.generation,
      request.payload.elementId,
      request.payload.text,
      request.payload.replace,
      request.payload.expected,
    );
  }
  if (request.type === "PAGE_SELECT_OPTION") {
    return actions.selectOption(
      request.payload.generation,
      request.payload.elementId,
      request.payload.optionLabel,
      request.payload.expected,
    );
  }
  if (request.type === "PAGE_SET_CHECKED") {
    return actions.setChecked(
      request.payload.generation,
      request.payload.elementId,
      request.payload.checked,
      request.payload.expected,
    );
  }
  if (request.type === "PAGE_SCROLL_ELEMENT") {
    return actions.scrollElement(
      request.payload.generation,
      request.payload.elementId,
      request.payload.direction,
      request.payload.amount,
      request.payload.expected,
    );
  }
  if (request.type === "PAGE_SCROLL") {
    return actions.scroll(request.payload.direction, request.payload.amount);
  }
  if (request.type === "PAGE_PRESS_KEY") return actions.pressKey(request.payload.key);
  return youtube.control(request.payload);
}

function actionNeedsSettlement(request: PageActionRequest): boolean {
  return (
    request.type === "PAGE_CLICK" ||
    request.type === "PAGE_SELECT_OPTION" ||
    request.type === "PAGE_SET_CHECKED" ||
    (request.type === "PAGE_PRESS_KEY" && request.payload.key === "Enter")
  );
}

async function handleMessage(message: unknown): Promise<ContentResponse<ContentData>> {
  const request = parseContentRequest(message);
  if (request === null)
    return errorResponse("unknown", "INVALID_MESSAGE", "Content request is invalid.");
  if (request.type === "CONTENT_PING") return { id: request.id, ok: true, data: { ready: true } };
  if (request.type === "PAGE_OBSERVE")
    return { id: request.id, ok: true, data: observer.observe() };
  if (request.type === "TRANSCRIPT_READ_CHUNK") {
    const domChunk = readTranscriptChunk(
      document,
      request.payload.cursor,
      request.payload.maxChars,
      request.payload.afterSegmentKey,
    );
    if (domChunk.available) {
      const stable = await readStableTranscriptChunk(
        document,
        request.payload.cursor,
        request.payload.maxChars,
        request.payload.afterSegmentKey,
        () => waitForPageSettled(document),
      );
      return { id: request.id, ok: true, data: stable };
    }
    const httpChunk = await readHttpTranscriptChunk(
      location,
      request.payload.cursor,
      request.payload.maxChars,
      request.payload.afterSegmentKey,
    );
    if (httpChunk.available) {
      return { id: request.id, ok: true, data: httpChunk };
    }
    const vttChunk = await readVttTranscriptChunk(
      document,
      location,
      request.payload.cursor,
      request.payload.maxChars,
      request.payload.afterSegmentKey,
    );
    return { id: request.id, ok: true, data: vttChunk };
  }
  try {
    const result = await executeAction(request);
    if (!actionNeedsSettlement(request)) return { id: request.id, ok: true, data: result };
    const pageSettled = await waitForPageSettled(document);
    return { id: request.id, ok: true, data: { ...result, pageSettled } };
  } catch (error: unknown) {
    if (error instanceof ActionExecutionError) {
      const retryable =
        error.code === "STALE_ELEMENT" ||
        error.code === "ELEMENT_NOT_FOUND" ||
        error.code === "ELEMENT_OCCLUDED" ||
        error.code === "YOUTUBE_SEARCH_FAILED";
      return {
        id: request.id,
        ok: false,
        error: { code: error.code, message: error.message, retryable },
      };
    }
    if (error instanceof YouTubeError)
      return errorResponse(request.id, "UNSAFE_ACTION", error.message);
    return errorResponse(request.id, "UNSAFE_ACTION", "The page action could not be completed.");
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  void handleMessage(message).then(
    (response) => {
      sendResponse(response);
    },
    () => {
      sendResponse(
        errorResponse("unknown", "UNSAFE_ACTION", "The page action could not be completed."),
      );
    },
  );
  return true;
});
