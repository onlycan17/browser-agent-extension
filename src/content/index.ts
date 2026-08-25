import type { PageActionRequest, PageActionResult } from "../shared/actions";
import { parseContentRequest, type ContentResponse } from "../shared/content-messages";
import type { PageSnapshot } from "../shared/page";
import { ElementRegistry } from "./element-registry";
import { ActionExecutionError, PageActionExecutor } from "./page-action-executor";
import { PageObserver } from "./page-observer";
import { YouTubeAdapter, YouTubeError } from "./youtube-adapter";

const registry = new ElementRegistry();
const observer = new PageObserver(registry);
const actions = new PageActionExecutor(registry);
const youtube = new YouTubeAdapter();

type ContentData = PageSnapshot | PageActionResult | { ready: true };

function errorResponse(id: string, code: string, message: string): ContentResponse<never> {
  return { id, ok: false, error: { code, message, retryable: false } };
}

async function executeAction(request: PageActionRequest): Promise<PageActionResult> {
  if (request.type === "PAGE_CLICK") {
    return actions.click(request.payload.generation, request.payload.elementId);
  }
  if (request.type === "PAGE_TYPE_TEXT") {
    return actions.typeText(
      request.payload.generation,
      request.payload.elementId,
      request.payload.text,
      request.payload.replace,
    );
  }
  if (request.type === "PAGE_SCROLL") {
    return actions.scroll(request.payload.direction, request.payload.amount);
  }
  if (request.type === "PAGE_PRESS_KEY") return actions.pressKey(request.payload.key);
  return youtube.control(request.payload);
}

async function handleMessage(message: unknown): Promise<ContentResponse<ContentData>> {
  const request = parseContentRequest(message);
  if (request === null)
    return errorResponse("unknown", "INVALID_MESSAGE", "Content request is invalid.");
  if (request.type === "CONTENT_PING") return { id: request.id, ok: true, data: { ready: true } };
  if (request.type === "PAGE_OBSERVE")
    return { id: request.id, ok: true, data: observer.observe() };
  try {
    return { id: request.id, ok: true, data: await executeAction(request) };
  } catch (error: unknown) {
    if (error instanceof ActionExecutionError)
      return errorResponse(request.id, error.code, error.message);
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
