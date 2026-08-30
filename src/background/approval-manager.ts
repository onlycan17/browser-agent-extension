interface PendingApproval {
  runId: string;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
  pause: boolean;
}

export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly approvedRuns = new Set<string>();

  isRunApproved(runId: string): boolean {
    return this.approvedRuns.has(runId);
  }

  request(runId: string, approvalId: string, timeoutMs = 60_000): Promise<boolean> {
    if (this.isRunApproved(runId)) return Promise.resolve(true);
    return this.createPending(runId, approvalId, timeoutMs, false);
  }

  requestPause(runId: string, approvalId: string, timeoutMs = 300_000): Promise<boolean> {
    return this.createPending(runId, approvalId, timeoutMs, true);
  }

  decide(runId: string, approvalId: string, approved: boolean): boolean {
    const pending = this.pending.get(approvalId);
    if (pending?.runId !== runId) return false;
    if (approved && !pending.pause) {
      this.approvedRuns.add(runId);
      this.resolveRun(runId, true);
      return true;
    }
    this.resolveApproval(approvalId, approved);
    return true;
  }

  cancelRun(runId: string): void {
    this.approvedRuns.delete(runId);
    this.resolveRun(runId, false);
  }

  private createPending(
    runId: string,
    approvalId: string,
    timeoutMs: number,
    pause: boolean,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(approvalId);
        resolve(false);
      }, timeoutMs);
      this.pending.set(approvalId, { runId, resolve, timeout, pause });
    });
  }

  private resolveRun(runId: string, approved: boolean): void {
    for (const [approvalId, pending] of this.pending) {
      if (pending.runId === runId) this.resolveApproval(approvalId, approved);
    }
  }

  private resolveApproval(approvalId: string, approved: boolean): void {
    const pending = this.pending.get(approvalId);
    if (pending === undefined) return;
    clearTimeout(pending.timeout);
    this.pending.delete(approvalId);
    pending.resolve(approved);
  }
}
