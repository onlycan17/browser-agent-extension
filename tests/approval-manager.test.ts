import { describe, expect, it } from "vitest";
import { ApprovalManager } from "../src/background/approval-manager";

describe("ApprovalManager", () => {
  it("accepts a matching one-time decision", async () => {
    const manager = new ApprovalManager();
    const decision = manager.request("run-1", "approval-1", 1000);

    expect(manager.decide("run-1", "approval-1", true)).toBe(true);
    await expect(decision).resolves.toBe(true);
    expect(manager.decide("run-1", "approval-1", true)).toBe(false);
  });

  it("rejects decisions for another run", () => {
    const manager = new ApprovalManager();
    void manager.request("run-1", "approval-1", 1);

    expect(manager.decide("run-2", "approval-1", true)).toBe(false);
  });

  it("resolves pending approvals as denied when a run is cancelled", async () => {
    const manager = new ApprovalManager();
    const decision = manager.request("run-1", "approval-1", 1000);

    manager.cancelRun("run-1");

    await expect(decision).resolves.toBe(false);
  });
});
