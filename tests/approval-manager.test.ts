import { describe, expect, it, vi } from "vitest";
import { ApprovalManager } from "../src/background/approval-manager";

describe("ApprovalManager", () => {
  it("grants approval to the rest of the matching run", async () => {
    const manager = new ApprovalManager();
    const decision = manager.request("run-1", "approval-1", 1000);

    expect(manager.decide("run-1", "approval-1", true)).toBe(true);
    await expect(decision).resolves.toBe(true);
    await expect(manager.request("run-1", "approval-2", 1000)).resolves.toBe(true);
    expect(manager.isRunApproved("run-1")).toBe(true);
    expect(manager.isRunApproved("run-2")).toBe(false);
    expect(manager.decide("run-1", "approval-1", true)).toBe(false);
  });

  it("resolves every pending approval in the matching run", async () => {
    const manager = new ApprovalManager();
    const first = manager.request("run-1", "approval-1", 1000);
    const second = manager.request("run-1", "approval-2", 1000);

    expect(manager.decide("run-1", "approval-1", true)).toBe(true);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
  });

  it("rejects decisions for another run", () => {
    const manager = new ApprovalManager();
    void manager.request("run-1", "approval-1", 1);

    expect(manager.decide("run-2", "approval-1", true)).toBe(false);
  });

  it("does not grant the run when the user denies an action", async () => {
    const manager = new ApprovalManager();
    const decision = manager.request("run-1", "approval-1", 1000);

    expect(manager.decide("run-1", "approval-1", false)).toBe(true);

    await expect(decision).resolves.toBe(false);
    expect(manager.isRunApproved("run-1")).toBe(false);
  });

  it("rejects a late decision after the approval times out", async () => {
    vi.useFakeTimers();
    try {
      const manager = new ApprovalManager();
      const decision = manager.request("run-1", "approval-1", 1000);

      await vi.advanceTimersByTimeAsync(1000);

      await expect(decision).resolves.toBe(false);
      expect(manager.decide("run-1", "approval-1", true)).toBe(false);
      expect(manager.isRunApproved("run-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves pending approvals as denied when a run is cancelled", async () => {
    const manager = new ApprovalManager();
    const decision = manager.request("run-1", "approval-1", 1000);

    manager.cancelRun("run-1");

    await expect(decision).resolves.toBe(false);
    expect(manager.decide("run-1", "approval-1", true)).toBe(false);
  });

  it("clears the run grant when the run is cancelled", async () => {
    const manager = new ApprovalManager();
    const decision = manager.request("run-1", "approval-1", 1000);
    manager.decide("run-1", "approval-1", true);
    await decision;

    manager.cancelRun("run-1");

    expect(manager.isRunApproved("run-1")).toBe(false);
  });

  it("keeps a pause request pending even when the run already has an action grant", async () => {
    const manager = new ApprovalManager();
    manager.decide("run-1", "seed-approval", true);
    const decision = manager.requestPause("run-1", "pause-1", 1000);
    let resolved = false;
    void decision.then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    manager.decide("run-1", "pause-1", true);
    await expect(decision).resolves.toBe(true);
    expect(manager.isRunApproved("run-1")).toBe(false);
  });

  it("resolves a pause decision without granting action approvals", async () => {
    const manager = new ApprovalManager();
    const decision = manager.requestPause("run-1", "pause-1", 1000);

    manager.decide("run-1", "pause-1", true);

    await expect(decision).resolves.toBe(true);
    expect(manager.isRunApproved("run-1")).toBe(false);
    expect(manager.decide("run-1", "pause-1", true)).toBe(false);
  });

  it("resolves pending pauses as denied when a run is cancelled", async () => {
    const manager = new ApprovalManager();
    const decision = manager.requestPause("run-1", "pause-1", 1000);

    manager.cancelRun("run-1");

    await expect(decision).resolves.toBe(false);
  });
});
