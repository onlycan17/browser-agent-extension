import { describe, expect, it } from "vitest";
import { PanelRunState } from "../src/sidepanel/run-state";

describe("PanelRunState", () => {
  it("ignores late events and completion from an older run", () => {
    const state = new PanelRunState();
    state.begin("run-a");
    state.begin("run-b");

    expect(state.matches("run-a")).toBe(false);
    expect(state.finish("run-a")).toBe(false);
    expect(state.activeId()).toBe("run-b");
  });

  it("clears only the matching active run", () => {
    const state = new PanelRunState();
    state.begin("run-a");

    expect(state.finish("run-a")).toBe(true);
    expect(state.activeId()).toBeNull();
  });
});
