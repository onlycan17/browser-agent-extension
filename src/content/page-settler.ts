export interface PageSettleOptions {
  quietMs: number;
  maxWaitMs: number;
}

const DEFAULT_SETTLE_OPTIONS: PageSettleOptions = { quietMs: 300, maxWaitMs: 1_500 };

export function waitForPageSettled(
  documentValue: Document,
  options: PageSettleOptions = DEFAULT_SETTLE_OPTIONS,
): Promise<boolean> {
  const quietMs = Math.max(50, Math.min(options.quietMs, 1_000));
  const maxWaitMs = Math.max(quietMs, Math.min(options.maxWaitMs, 5_000));
  const root = documentValue.documentElement;
  const ViewMutationObserver = documentValue.defaultView?.MutationObserver;
  if (ViewMutationObserver === undefined) {
    return new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, quietMs),
    );
  }
  return new Promise((resolve) => {
    let finished = false;
    let quietTimer: ReturnType<typeof setTimeout>;
    const finish = (settled: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(quietTimer);
      clearTimeout(maximumTimer);
      observer.disconnect();
      resolve(settled);
    };
    const scheduleQuiet = (): void => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        finish(true);
      }, quietMs);
    };
    const observer = new ViewMutationObserver(() => {
      scheduleQuiet();
    });
    observer.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const maximumTimer = setTimeout(() => {
      finish(false);
    }, maxWaitMs);
    scheduleQuiet();
  });
}
