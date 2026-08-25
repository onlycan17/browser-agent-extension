import type { PageActionRequest, PageActionResult } from "../shared/actions";
import {
  parseActionResponse,
  parseObserveResponse,
  parsePingResponse,
} from "../shared/content-messages";
import type { PageSnapshot } from "../shared/page";

export type PageAccessErrorCode =
  | "UNSUPPORTED_PAGE"
  | "CONTENT_UNAVAILABLE"
  | "CAPTURE_FAILED"
  | "TAB_CHANGED"
  | "TAB_ACCESS_REQUIRED";

export class PageAccessError extends Error {
  constructor(
    readonly code: PageAccessErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PageAccessError";
  }
}

export interface TabContext {
  id: number;
  windowId: number;
  url: string;
}

export interface BrowserTabAdapter {
  queryActive(): Promise<
    { id?: number | undefined; windowId?: number | undefined; url?: string | undefined }[]
  >;
  send(tabId: number, message: unknown): Promise<unknown>;
  inject(tabId: number): Promise<void>;
  capture(windowId: number): Promise<string>;
}

function isSupportedUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function createChromeTabAdapter(): BrowserTabAdapter {
  return {
    queryActive: () => chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    inject: async (tabId) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    },
    capture: (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
  };
}

export class TabService {
  private lastCaptureAt = Number.NEGATIVE_INFINITY;
  private readonly pinnedTabs = new Map<string, TabContext>();

  constructor(
    private readonly adapter: BrowserTabAdapter,
    private readonly now: () => number = Date.now,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async pinActivePage(runId: string): Promise<void> {
    this.pinnedTabs.set(runId, await this.activeTab());
  }

  releasePinnedPage(runId: string): void {
    this.pinnedTabs.delete(runId);
  }

  async observeActivePage(runId?: string): Promise<PageSnapshot> {
    const tab = await this.tabForRun(runId);
    await this.ensureContentScript(tab.id);
    const id = crypto.randomUUID();
    const response = await this.adapter.send(tab.id, { id, type: "PAGE_OBSERVE", payload: {} });
    const snapshot = parseObserveResponse(response, id);
    if (snapshot === null)
      throw new PageAccessError(
        "CONTENT_UNAVAILABLE",
        "The page did not return a valid observation.",
        true,
      );
    if (runId !== undefined) await this.validateRunSnapshot(runId, snapshot);
    return snapshot;
  }

  async executeAction(action: PageActionRequest, runId?: string): Promise<PageActionResult> {
    const tab = await this.tabForRun(runId);
    await this.ensureContentScript(tab.id);
    const id = crypto.randomUUID();
    const response = await this.adapter.send(tab.id, { id, ...action });
    const result = parseActionResponse(response, id);
    if (result === null) {
      throw new PageAccessError(
        "CONTENT_UNAVAILABLE",
        "The page did not execute the action.",
        true,
      );
    }
    if (runId !== undefined) await this.tabForRun(runId);
    return result;
  }

  async captureActivePage(runId?: string): Promise<string> {
    const tab = await this.tabForRun(runId);
    const elapsed = this.now() - this.lastCaptureAt;
    if (elapsed < 550) await this.delay(550 - elapsed);
    const dataUrl = await this.adapter.capture(tab.windowId);
    if (runId !== undefined) await this.tabForRun(runId);
    this.lastCaptureAt = this.now();
    if (!dataUrl.startsWith("data:image/")) {
      throw new PageAccessError(
        "CAPTURE_FAILED",
        "Chrome did not return a valid screenshot.",
        true,
      );
    }
    return dataUrl;
  }

  private async validateRunSnapshot(runId: string, snapshot: PageSnapshot): Promise<void> {
    await this.tabForRun(runId);
    if (this.pinnedTabs.get(runId)?.url === snapshot.url) return;
    throw this.tabChangedError();
  }

  private tabChangedError(): PageAccessError {
    return new PageAccessError(
      "TAB_CHANGED",
      "The active tab changed during the agent run.",
      false,
    );
  }

  private async tabForRun(runId?: string): Promise<TabContext> {
    const active = await this.activeTab();
    if (runId === undefined) return active;
    const pinned = this.pinnedTabs.get(runId);
    if (
      pinned?.id !== active.id ||
      pinned.windowId !== active.windowId ||
      pinned.url !== active.url
    ) {
      throw this.tabChangedError();
    }
    return active;
  }

  private async activeTab(): Promise<TabContext> {
    const tab = (await this.adapter.queryActive())[0];
    if (tab?.id === undefined || tab.windowId === undefined) {
      throw new PageAccessError("UNSUPPORTED_PAGE", "No active browser page is available.", false);
    }
    if (tab.url === undefined) {
      throw new PageAccessError(
        "TAB_ACCESS_REQUIRED",
        "Open the target page, then click the Browser Agent toolbar icon to grant access.",
        false,
      );
    }
    if (!isSupportedUrl(tab.url)) {
      throw new PageAccessError(
        "UNSUPPORTED_PAGE",
        "Browser Agent cannot operate on this page.",
        false,
      );
    }
    return { id: tab.id, windowId: tab.windowId, url: tab.url };
  }

  private async ensureContentScript(tabId: number): Promise<void> {
    const id = crypto.randomUUID();
    try {
      const response = await this.adapter.send(tabId, { id, type: "CONTENT_PING", payload: {} });
      if (parsePingResponse(response, id)) return;
    } catch {
      await this.adapter.inject(tabId);
      return;
    }
    await this.adapter.inject(tabId);
  }
}
