import type { PageActionRequest, PageActionResult } from "../shared/actions";
import {
  parseContentErrorResponse,
  parseActionResponse,
  parseObserveResponse,
  parsePingResponse,
  parseTranscriptChunkResponse,
} from "../shared/content-messages";
import type { PageSnapshot } from "../shared/page";
import type { TranscriptChunkResult } from "../shared/transcript";

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

export class PageActionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PageActionError";
  }
}

export interface TabContext {
  id: number;
  windowId: number;
  url: string;
}

export interface BrowserTabSnapshot {
  id?: number | undefined;
  windowId?: number | undefined;
  url?: string | undefined;
  pendingUrl?: string | undefined;
  openerTabId?: number | undefined;
}

export interface BrowserTabAdapter {
  queryActive(): Promise<BrowserTabSnapshot[]>;
  get(tabId: number): Promise<BrowserTabSnapshot>;
  queryActiveInWindow(windowId: number): Promise<BrowserTabSnapshot[]>;
  send(tabId: number, message: unknown): Promise<unknown>;
  inject(tabId: number): Promise<void>;
  capture(windowId: number): Promise<string>;
  activate(tabId: number): Promise<void>;
  focusWindow(windowId: number): Promise<void>;
  onTabCreated(listener: (tab: BrowserTabSnapshot) => void): void;
}

function isSupportedUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function hasSameOrigin(first: string, second: string): boolean {
  try {
    return new URL(first).origin === new URL(second).origin;
  } catch {
    return false;
  }
}

function mayNavigate(action: PageActionRequest): boolean {
  return (
    action.type === "PAGE_CLICK" ||
    action.type === "PAGE_SELECT_OPTION" ||
    action.type === "PAGE_SET_CHECKED" ||
    (action.type === "PAGE_PRESS_KEY" && action.payload.key === "Enter")
  );
}

export function createChromeTabAdapter(): BrowserTabAdapter {
  return {
    queryActive: () => chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    get: (tabId) => chrome.tabs.get(tabId),
    queryActiveInWindow: (windowId) => chrome.tabs.query({ active: true, windowId }),
    send: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
    inject: async (tabId) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    },
    capture: (windowId) => chrome.tabs.captureVisibleTab(windowId, { format: "png" }),
    activate: async (tabId) => {
      await chrome.tabs.update(tabId, { active: true });
    },
    focusWindow: async (windowId) => {
      await chrome.windows.update(windowId, { focused: true });
    },
    onTabCreated: (listener) => {
      chrome.tabs.onCreated.addListener((tab) => {
        listener({
          id: tab.id,
          windowId: tab.windowId,
          ...(tab.url === undefined ? {} : { url: tab.url }),
          ...(tab.pendingUrl === undefined ? {} : { pendingUrl: tab.pendingUrl }),
          ...(tab.openerTabId === undefined ? {} : { openerTabId: tab.openerTabId }),
        });
      });
    },
  };
}

interface TabCandidate {
  tabId: number;
  openerTabId: number | undefined;
  createdAt: number;
}

export const TAB_CANDIDATE_TTL_MS = 120_000;
const MAX_TAB_CANDIDATES = 50;

export class TabService {
  private lastCaptureAt = Number.NEGATIVE_INFINITY;
  private readonly sessionTabs = new Map<string, TabContext>();
  private readonly navigationAllowances = new Set<string>();
  private readonly lastNavigatingActionAt = new Map<string, number>();
  private readonly tabCandidates: TabCandidate[] = [];

  constructor(
    private readonly adapter: BrowserTabAdapter,
    private readonly now: () => number = Date.now,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async pinActivePage(runId: string): Promise<void> {
    this.sessionTabs.set(runId, await this.activeTab());
    this.navigationAllowances.delete(runId);
    this.lastNavigatingActionAt.delete(runId);
  }

  releasePinnedPage(runId: string): void {
    this.sessionTabs.delete(runId);
    this.navigationAllowances.delete(runId);
    this.lastNavigatingActionAt.delete(runId);
  }

  noteTabCreated(tab: BrowserTabSnapshot): void {
    if (tab.id === undefined) return;
    this.pruneTabCandidates();
    if (this.tabCandidates.length >= MAX_TAB_CANDIDATES) this.tabCandidates.shift();
    this.tabCandidates.push({
      tabId: tab.id,
      openerTabId: tab.openerTabId,
      createdAt: this.now(),
    });
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

  async executeAction(
    action: PageActionRequest,
    runId?: string,
    signal?: AbortSignal,
  ): Promise<PageActionResult> {
    signal?.throwIfAborted();
    const tab = await this.tabForRun(runId);
    await this.ensureContentScript(tab.id);
    signal?.throwIfAborted();
    if (runId !== undefined && mayNavigate(action)) {
      this.navigationAllowances.add(runId);
      this.lastNavigatingActionAt.set(runId, this.now());
    }
    const id = crypto.randomUUID();
    const response = await this.adapter.send(tab.id, { id, ...action });
    signal?.throwIfAborted();
    const result = parseActionResponse(response, id);
    if (result === null) {
      const actionError = parseContentErrorResponse(response, id);
      if (actionError !== null) {
        throw new PageActionError(actionError.code, actionError.message, actionError.retryable);
      }
      throw new PageAccessError(
        "CONTENT_UNAVAILABLE",
        "The page did not execute the action.",
        true,
      );
    }
    if (runId !== undefined) await this.tabForRun(runId);
    return result;
  }

  async readTranscriptChunk(
    runId: string,
    cursor: number,
    maxChars: number,
    afterSegmentKey: string,
    signal?: AbortSignal,
  ): Promise<TranscriptChunkResult> {
    signal?.throwIfAborted();
    const tab = await this.tabForRun(runId);
    await this.ensureContentScript(tab.id);
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const response = await this.adapter.send(tab.id, {
      id,
      type: "TRANSCRIPT_READ_CHUNK",
      payload: { cursor, maxChars, afterSegmentKey },
    });
    signal?.throwIfAborted();
    const result = parseTranscriptChunkResponse(response, id);
    if (result === null) {
      throw new PageAccessError(
        "CONTENT_UNAVAILABLE",
        "The page did not return a valid transcript chunk.",
        true,
      );
    }
    await this.tabForRun(runId);
    return result;
  }

  async captureActivePage(runId?: string): Promise<string> {
    const tab = await this.tabForRun(runId);
    const dataUrl = await this.captureTrackedTab(tab);
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

  private async captureTrackedTab(tab: TabContext): Promise<string> {
    const activeInWindow = await this.adapter.queryActiveInWindow(tab.windowId).catch(() => []);
    if (activeInWindow.some((item) => item.id === tab.id)) {
      return this.pacedCapture(tab.windowId);
    }
    const previousTabId = activeInWindow[0]?.id;
    try {
      await this.adapter.activate(tab.id);
      await this.adapter.focusWindow(tab.windowId);
      return await this.pacedCapture(tab.windowId);
    } finally {
      if (previousTabId !== undefined) await this.restoreActiveTab(previousTabId);
    }
  }

  private async restoreActiveTab(tabId: number): Promise<void> {
    await this.adapter.activate(tabId).catch(() => undefined);
  }

  private async capture(windowId: number): Promise<string> {
    try {
      return await this.adapter.capture(windowId);
    } catch {
      throw new PageAccessError(
        "CAPTURE_FAILED",
        "Chrome could not capture this page. Return to the target tab and click the Browser Agent toolbar icon, then try again.",
        true,
      );
    }
  }

  private async pacedCapture(windowId: number): Promise<string> {
    const elapsed = this.now() - this.lastCaptureAt;
    if (elapsed < 550) await this.delay(550 - elapsed);
    const dataUrl = await this.capture(windowId);
    this.lastCaptureAt = this.now();
    return dataUrl;
  }

  private async validateRunSnapshot(runId: string, snapshot: PageSnapshot): Promise<void> {
    const tab = await this.tabForRun(runId);
    this.navigationAllowances.delete(runId);
    if (tab.url === snapshot.url) return;
    throw this.tabChangedError();
  }

  private tabChangedError(): PageAccessError {
    return new PageAccessError(
      "TAB_CHANGED",
      "The agent page closed or navigated unexpectedly during the run.",
      false,
    );
  }

  private async tabForRun(runId?: string): Promise<TabContext> {
    if (runId === undefined) return this.activeTab();
    const session = this.sessionTabs.get(runId);
    if (session === undefined) {
      const active = await this.activeTab();
      this.sessionTabs.set(runId, active);
      return active;
    }
    const refreshed = await this.getTab(session.id);
    if (refreshed !== null) {
      const candidate = await this.handoffCandidate(runId, session);
      if (candidate !== null) return this.adoptSessionTab(runId, candidate);
      return this.validateSessionUrl(runId, session, refreshed);
    }
    const candidate = await this.handoffCandidate(runId, session);
    if (candidate === null) throw this.tabChangedError();
    return this.adoptSessionTab(runId, candidate);
  }

  private async getTab(
    tabId: number,
  ): Promise<{ id: number; windowId: number; url?: string } | null> {
    try {
      const tab = await this.adapter.get(tabId);
      if (tab.id === undefined || tab.windowId === undefined) return null;
      return {
        id: tab.id,
        windowId: tab.windowId,
        ...(tab.url === undefined ? {} : { url: tab.url }),
      };
    } catch {
      return null;
    }
  }

  private async handoffCandidate(runId: string, session: TabContext): Promise<TabContext | null> {
    const since = this.lastNavigatingActionAt.get(runId);
    if (since === undefined) return null;
    this.pruneTabCandidates();
    for (let index = this.tabCandidates.length - 1; index >= 0; index -= 1) {
      const candidate = this.tabCandidates[index];
      if (candidate === undefined) continue;
      if (candidate.openerTabId !== session.id || candidate.createdAt < since) continue;
      const refreshed = await this.getTab(candidate.tabId);
      if (refreshed?.url === undefined) continue;
      if (!isSupportedUrl(refreshed.url)) continue;
      this.tabCandidates.splice(index, 1);
      return { id: refreshed.id, windowId: refreshed.windowId, url: refreshed.url };
    }
    return null;
  }

  private adoptSessionTab(runId: string, context: TabContext): TabContext {
    this.sessionTabs.set(runId, context);
    this.navigationAllowances.delete(runId);
    this.lastNavigatingActionAt.delete(runId);
    return context;
  }

  private validateSessionUrl(
    runId: string,
    session: TabContext,
    refreshed: { id: number; windowId: number; url?: string },
  ): TabContext {
    const active = this.tabContext({
      id: refreshed.id,
      windowId: refreshed.windowId,
      ...(refreshed.url === undefined ? {} : { url: refreshed.url }),
    });
    if (session.url === active.url) return active;
    if (this.navigationAllowances.has(runId) && hasSameOrigin(session.url, active.url)) {
      this.sessionTabs.set(runId, active);
      this.navigationAllowances.delete(runId);
      return active;
    }
    this.navigationAllowances.delete(runId);
    throw this.tabChangedError();
  }

  private pruneTabCandidates(): void {
    const cutoff = this.now() - TAB_CANDIDATE_TTL_MS;
    for (;;) {
      const oldest = this.tabCandidates[0];
      if (oldest === undefined || oldest.createdAt >= cutoff) return;
      this.tabCandidates.shift();
    }
  }

  private async activeTab(): Promise<TabContext> {
    const tab = (await this.adapter.queryActive())[0];
    if (tab?.id === undefined || tab.windowId === undefined) {
      throw new PageAccessError("UNSUPPORTED_PAGE", "No active browser page is available.", false);
    }
    return this.tabContext({
      id: tab.id,
      windowId: tab.windowId,
      ...(tab.url === undefined ? {} : { url: tab.url }),
    });
  }

  private tabContext(tab: { id: number; windowId: number; url?: string }): TabContext {
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
      await this.injectContentScript(tabId);
      return;
    }
    await this.injectContentScript(tabId);
  }

  private async injectContentScript(tabId: number): Promise<void> {
    try {
      await this.adapter.inject(tabId);
    } catch {
      throw new PageAccessError(
        "TAB_ACCESS_REQUIRED",
        "Browser Agent cannot access this page. Switch to the target tab and click the Browser Agent toolbar icon again, or grant the site permission in settings.",
        false,
      );
    }
  }
}
