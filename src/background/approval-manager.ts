interface PendingApproval {
  runId: string;
  resolve: (approved: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();

  request(runId: string, approvalId: string, timeoutMs = 60_000): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(approvalId);
        resolve(false);
      }, timeoutMs);
      this.pending.set(approvalId, { runId, resolve, timeout });
    });
  }

  decide(runId: string, approvalId: string, approved: boolean): boolean {
    const pending = this.pending.get(approvalId);
    if (pending?.runId !== runId) return false;
    clearTimeout(pending.timeout);
    this.pending.delete(approvalId);
    pending.resolve(approved);
    return true;
  }

  cancelRun(runId: string): void {
    for (const [approvalId, pending] of this.pending) {
      if (pending.runId !== runId) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(approvalId);
      pending.resolve(false);
    }
  }
}
