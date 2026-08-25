import { describe, expect, it, vi } from "vitest";
import { openPanelForAction } from "../src/background/action-panel";

describe("openPanelForAction", () => {
  it("opens a tab-scoped side panel from the action click", async () => {
    const open = vi.fn(() => Promise.resolve());

    openPanelForAction({ id: 42 }, { open }, () => undefined);
    await Promise.resolve();

    expect(open).toHaveBeenCalledWith({ tabId: 42 });
  });

  it("ignores action events without a tab ID", () => {
    const open = vi.fn(() => Promise.resolve());

    openPanelForAction({ id: undefined }, { open }, () => undefined);

    expect(open).not.toHaveBeenCalled();
  });

  it("reports panel-open failures", async () => {
    const onFailure = vi.fn();

    openPanelForAction(
      { id: 42 },
      { open: () => Promise.reject(new Error("open failed")) },
      onFailure,
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(onFailure).toHaveBeenCalledOnce();
  });
});
