import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForPageSettled } from "../src/content/page-settler";

describe("waitForPageSettled", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for a quiet period after the latest DOM mutation", async () => {
    let completed = false;
    const settled = waitForPageSettled(document, { quietMs: 200, maxWaitMs: 1_000 }).then(
      (value) => {
        completed = true;
        return value;
      },
    );
    await vi.advanceTimersByTimeAsync(150);
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(199);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(settled).resolves.toBe(true);
  });

  it("returns false at the maximum wait boundary", async () => {
    const settled = waitForPageSettled(document, { quietMs: 400, maxWaitMs: 500 });
    await vi.advanceTimersByTimeAsync(300);
    document.body.append(document.createElement("div"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    await expect(settled).resolves.toBe(false);
  });
});
