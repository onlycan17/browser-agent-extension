import { describe, expect, it, vi } from "vitest";
import type { PageActionRequest } from "../src/shared/actions";
import {
  createChromeTabAdapter,
  PageActionError,
  PageAccessError,
  TabService,
  type BrowserTabAdapter,
} from "../src/background/tab-service";

function pageSnapshot(url = "https://example.com/") {
  return {
    generation: 1,
    url,
    title: "Example",
    viewport: { width: 1000, height: 800, scrollX: 0, scrollY: 0 },
    visibleText: "Example page",
    elements: [],
  };
}

const expectedTarget = {
  id: "e-1",
  tag: "button",
  role: "button",
  name: "Continue",
  disabled: false,
  bounds: { x: 10, y: 10, width: 100, height: 30 },
};

function createAdapter(overrides: Partial<BrowserTabAdapter> = {}): BrowserTabAdapter {
  return {
    queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: "https://example.com/" }]),
    send: (_tabId, message) => {
      if (typeof message !== "object" || message === null || !("id" in message))
        return Promise.resolve(null);
      const id = typeof message.id === "string" ? message.id : "unknown";
      if ("type" in message && message.type === "CONTENT_PING") {
        return Promise.resolve({ id, ok: true, data: { ready: true } });
      }
      return Promise.resolve({ id, ok: true, data: pageSnapshot() });
    },
    inject: () => Promise.resolve(),
    capture: () => Promise.resolve("data:image/png;base64,abc"),
    ...overrides,
  };
}

describe("TabService", () => {
  it("queries the active tab from Chrome's last-focused window", async () => {
    const query = vi.fn(() => Promise.resolve([]));
    vi.stubGlobal("chrome", {
      tabs: {
        query,
        sendMessage: () => Promise.resolve(),
        captureVisibleTab: () => Promise.resolve("data:image/png;base64,abc"),
      },
      scripting: { executeScript: () => Promise.resolve([]) },
    });
    try {
      await createChromeTabAdapter().queryActive();

      expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("observes an active supported page", async () => {
    const service = new TabService(createAdapter());

    await expect(service.observeActivePage()).resolves.toMatchObject({ title: "Example" });
  });

  it("preserves a structured page-action error from the content script", async () => {
    const adapter = createAdapter({
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        return Promise.resolve({
          id: message.id,
          ok: false,
          error: {
            code: "STALE_ELEMENT",
            message: "The target changed after observation; observe it again.",
            retryable: true,
          },
        });
      },
    });
    const service = new TabService(adapter);

    await expect(
      service.executeAction({
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1", expected: expectedTarget },
      }),
    ).rejects.toEqual(
      new PageActionError(
        "STALE_ELEMENT",
        "The target changed after observation; observe it again.",
        true,
      ),
    );
  });

  it("reads a validated transcript chunk from the pinned page", async () => {
    const send = vi.fn((_tabId: number, message: unknown) => {
      if (typeof message !== "object" || message === null || !("id" in message)) {
        return Promise.resolve(null);
      }
      const id = typeof message.id === "string" ? message.id : "unknown";
      if ("type" in message && message.type === "CONTENT_PING") {
        return Promise.resolve({ id, ok: true, data: { ready: true } });
      }
      return Promise.resolve({
        id,
        ok: true,
        data: {
          available: true,
          cursor: 0,
          nextCursor: 2,
          done: true,
          startTime: "00:00",
          endTime: "00:30",
          contextText: "",
          text: "[00:00] Intro\n[00:30] End",
          segmentCount: 2,
          totalSegments: 2,
        },
      });
    });
    const service = new TabService(createAdapter({ send }));
    await service.pinActivePage("run-transcript");

    await expect(
      service.readTranscriptChunk("run-transcript", 0, 8_000, new AbortController().signal),
    ).resolves.toMatchObject({ available: true, done: true, segmentCount: 2 });
    expect(send).toHaveBeenLastCalledWith(
      4,
      expect.objectContaining({
        type: "TRANSCRIPT_READ_CHUNK",
        payload: { cursor: 0, maxChars: 8_000 },
      }),
    );
  });

  it("explains how to grant access when Chrome omits the active tab URL", async () => {
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2 }]),
    });
    const service = new TabService(adapter);

    await expect(service.observeActivePage()).rejects.toEqual(
      new PageAccessError(
        "TAB_ACCESS_REQUIRED",
        "Open the target page, then click the Browser Agent toolbar icon to grant access.",
        false,
      ),
    );
  });

  it("rejects restricted browser pages before injection", async () => {
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: "chrome://settings" }]),
    });
    const service = new TabService(adapter);

    await expect(service.observeActivePage()).rejects.toEqual(
      new PageAccessError("UNSUPPORTED_PAGE", "Browser Agent cannot operate on this page.", false),
    );
  });

  it("injects the content script when ping fails", async () => {
    let injected = 0;
    let calls = 0;
    const adapter = createAdapter({
      send: (_tabId, message) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("No receiver"));
        if (typeof message !== "object" || message === null || !("id" in message))
          return Promise.resolve(null);
        return Promise.resolve({ id: message.id, ok: true, data: pageSnapshot() });
      },
      inject: () => {
        injected += 1;
        return Promise.resolve();
      },
    });
    const service = new TabService(adapter);

    await service.observeActivePage();

    expect(injected).toBe(1);
  });

  it("does not dispatch an action after the run is aborted", async () => {
    const baseAdapter = createAdapter();
    const send = vi.fn((tabId: number, message: unknown) => baseAdapter.send(tabId, message));
    const service = new TabService(createAdapter({ send }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.executeAction(
        { type: "PAGE_SCROLL", payload: { direction: "down", amount: 200 } },
        "run-aborted",
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects an agent action after the active tab changes", async () => {
    let activeTabId = 4;
    const adapter = createAdapter({
      queryActive: () =>
        Promise.resolve([{ id: activeTabId, windowId: 2, url: "https://example.com/" }]),
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");
    activeTabId = 5;

    await expect(service.observeActivePage("run-1")).rejects.toEqual(
      new PageAccessError("TAB_CHANGED", "The active tab changed during the agent run.", false),
    );
  });

  it("reports a tab change before requesting access to the newly active tab", async () => {
    let activeTabId = 4;
    const adapter = createAdapter({
      queryActive: () =>
        Promise.resolve(
          activeTabId === 4
            ? [{ id: 4, windowId: 2, url: "https://example.com/" }]
            : [{ id: 5, windowId: 2 }],
        ),
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");
    activeTabId = 5;

    await expect(service.observeActivePage("run-1")).rejects.toEqual(
      new PageAccessError("TAB_CHANGED", "The active tab changed during the agent run.", false),
    );
  });

  it("rejects an agent action after same-tab navigation", async () => {
    let activeUrl = "https://example.com/start";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");
    activeUrl = "https://example.com/next";

    await expect(service.observeActivePage("run-1")).rejects.toMatchObject({
      code: "TAB_CHANGED",
    });
  });

  it.each([
    {
      label: "approved click",
      action: {
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1", expected: expectedTarget },
      },
    },
    {
      label: "approved Enter",
      action: { type: "PAGE_PRESS_KEY", payload: { key: "Enter" } },
    },
  ] satisfies { label: string; action: PageActionRequest }[])(
    "continues after $label causes same-origin navigation",
    async ({ action }) => {
      let activeUrl = "https://example.com/start";
      const adapter = createAdapter({
        queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
        send: (_tabId, message) => {
          if (typeof message !== "object" || message === null || !("id" in message)) {
            return Promise.resolve(null);
          }
          if ("type" in message && message.type === "CONTENT_PING") {
            return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
          }
          if ("type" in message && message.type === "PAGE_OBSERVE") {
            return Promise.resolve({ id: message.id, ok: true, data: pageSnapshot(activeUrl) });
          }
          activeUrl = "https://example.com/results";
          return Promise.resolve({ id: message.id, ok: true, data: { message: "Navigated." } });
        },
      });
      const service = new TabService(adapter);
      await service.pinActivePage("run-1");

      await service.executeAction(action, "run-1");

      await expect(service.observeActivePage("run-1")).resolves.toMatchObject({
        url: "https://example.com/results",
      });
    },
  );

  it("recovers navigation when the action response is lost during unload", async () => {
    let activeUrl = "https://example.com/start";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        if ("type" in message && message.type === "PAGE_OBSERVE") {
          return Promise.resolve({ id: message.id, ok: true, data: pageSnapshot(activeUrl) });
        }
        activeUrl = "https://example.com/results";
        return Promise.reject(new Error("The source document unloaded."));
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");

    await expect(
      service.executeAction(
        {
          type: "PAGE_CLICK",
          payload: { generation: 1, elementId: "e-1", expected: expectedTarget },
        },
        "run-1",
      ),
    ).rejects.toThrow("The source document unloaded.");

    await expect(service.observeActivePage("run-1")).resolves.toMatchObject({
      url: "https://example.com/results",
    });
  });

  it("allows navigation that starts after the action response", async () => {
    let activeUrl = "https://example.com/start";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        if ("type" in message && message.type === "PAGE_OBSERVE") {
          return Promise.resolve({ id: message.id, ok: true, data: pageSnapshot(activeUrl) });
        }
        return Promise.resolve({ id: message.id, ok: true, data: { message: "Clicked." } });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");
    await service.executeAction(
      {
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1", expected: expectedTarget },
      },
      "run-1",
    );
    activeUrl = "https://example.com/results";

    await expect(service.observeActivePage("run-1")).resolves.toMatchObject({
      url: "https://example.com/results",
    });
  });

  it("rejects a tab switch after a click", async () => {
    let activeTabId = 4;
    const adapter = createAdapter({
      queryActive: () =>
        Promise.resolve([{ id: activeTabId, windowId: 2, url: "https://example.com/" }]),
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        activeTabId = 5;
        return Promise.resolve({ id: message.id, ok: true, data: { message: "Clicked." } });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");

    await expect(
      service.executeAction(
        {
          type: "PAGE_CLICK",
          payload: { generation: 1, elementId: "e-1", expected: expectedTarget },
        },
        "run-1",
      ),
    ).rejects.toMatchObject({ code: "TAB_CHANGED" });
  });

  it("rejects cross-origin navigation after a click", async () => {
    let activeUrl = "https://example.com/start";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        activeUrl = "https://other.example/results";
        return Promise.resolve({ id: message.id, ok: true, data: { message: "Navigated." } });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");

    await expect(
      service.executeAction(
        {
          type: "PAGE_CLICK",
          payload: { generation: 1, elementId: "e-1", expected: expectedTarget },
        },
        "run-1",
      ),
    ).rejects.toMatchObject({ code: "TAB_CHANGED" });
  });

  it("expires an unused navigation allowance after the next observation", async () => {
    let activeUrl = "https://example.com/start";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        if ("type" in message && message.type === "PAGE_OBSERVE") {
          return Promise.resolve({ id: message.id, ok: true, data: pageSnapshot(activeUrl) });
        }
        return Promise.resolve({ id: message.id, ok: true, data: { message: "Clicked." } });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");
    await service.executeAction(
      {
        type: "PAGE_CLICK",
        payload: { generation: 1, elementId: "e-1", expected: expectedTarget },
      },
      "run-1",
    );
    await service.observeActivePage("run-1");
    activeUrl = "https://example.com/unexpected";

    await expect(service.observeActivePage("run-1")).rejects.toMatchObject({
      code: "TAB_CHANGED",
    });
  });

  it("rejects an observation if navigation occurs during messaging", async () => {
    let activeUrl = "https://example.com/";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        activeUrl = "https://example.com/next";
        return Promise.resolve({ id: message.id, ok: true, data: pageSnapshot() });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");

    await expect(service.observeActivePage("run-1")).rejects.toMatchObject({
      code: "TAB_CHANGED",
    });
  });

  it("rejects an action if navigation occurs during messaging", async () => {
    let activeUrl = "https://example.com/";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        if ("type" in message && message.type === "CONTENT_PING") {
          return Promise.resolve({ id: message.id, ok: true, data: { ready: true } });
        }
        activeUrl = "https://example.com/next";
        return Promise.resolve({ id: message.id, ok: true, data: { message: "Scrolled." } });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");

    await expect(
      service.executeAction(
        { type: "PAGE_SCROLL", payload: { direction: "down", amount: 100 } },
        "run-1",
      ),
    ).rejects.toMatchObject({ code: "TAB_CHANGED" });
  });

  it("rejects an observation whose document URL differs from the pinned URL", async () => {
    const mismatchedSnapshot = { ...pageSnapshot(), url: "https://example.com/next" };
    const adapter = createAdapter({
      send: (_tabId, message) => {
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        const data =
          "type" in message && message.type === "CONTENT_PING"
            ? { ready: true }
            : mismatchedSnapshot;
        return Promise.resolve({ id: message.id, ok: true, data });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");

    await expect(service.observeActivePage("run-1")).rejects.toMatchObject({
      code: "TAB_CHANGED",
    });
  });

  it("rejects a screenshot if navigation occurs during capture", async () => {
    let activeUrl = "https://example.com/start";
    const adapter = createAdapter({
      queryActive: () => Promise.resolve([{ id: 4, windowId: 2, url: activeUrl }]),
      capture: () => {
        activeUrl = "https://example.com/next";
        return Promise.resolve("data:image/png;base64,abc");
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");

    await expect(service.captureActivePage("run-1")).rejects.toMatchObject({
      code: "TAB_CHANGED",
    });
  });

  it("allows non-agent analysis to follow the current active tab", async () => {
    let activeTabId = 4;
    const observedTabIds: number[] = [];
    const adapter = createAdapter({
      queryActive: () =>
        Promise.resolve([{ id: activeTabId, windowId: 2, url: "https://example.com/" }]),
      send: (tabId, message) => {
        observedTabIds.push(tabId);
        if (typeof message !== "object" || message === null || !("id" in message)) {
          return Promise.resolve(null);
        }
        const data =
          "type" in message && message.type === "CONTENT_PING" ? { ready: true } : pageSnapshot();
        return Promise.resolve({ id: message.id, ok: true, data });
      },
    });
    const service = new TabService(adapter);
    await service.pinActivePage("run-1");
    activeTabId = 5;

    await service.observeActivePage();

    expect(observedTabIds).toEqual([5, 5]);
  });

  it("maps a denied Chrome capture to an actionable page access error", async () => {
    const service = new TabService(
      createAdapter({
        capture: () => Promise.reject(new Error("Active tab permission is unavailable.")),
      }),
    );

    await expect(service.captureActivePage()).rejects.toEqual(
      new PageAccessError(
        "CAPTURE_FAILED",
        "Chrome could not capture this page. Return to the target tab and click the Browser Agent toolbar icon, then try again.",
        true,
      ),
    );
  });

  it("paces repeated screenshots below Chrome's capture limit", async () => {
    let now = 1_000;
    const delays: number[] = [];
    const service = new TabService(
      createAdapter(),
      () => now,
      (milliseconds) => {
        delays.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    );

    await service.captureActivePage();
    now += 100;
    await service.captureActivePage();

    expect(delays).toEqual([450]);
  });
});
