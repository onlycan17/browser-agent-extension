export class PanelRunState {
  private runId: string | null = null;

  begin(runId: string): void {
    this.runId = runId;
  }

  activeId(): string | null {
    return this.runId;
  }

  matches(runId: string): boolean {
    return this.runId === runId;
  }

  finish(runId: string): boolean {
    if (!this.matches(runId)) return false;
    this.runId = null;
    return true;
  }
}
