import type { AssistantMessage } from "../shared/llm";
import { ProviderError } from "./provider-http";

export const MAX_PROVIDER_RETRIES = 3;
export const PROVIDER_RETRY_BASE_DELAY_MS = 1_000;

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(errorFrom(signal.reason));
    };
    signal.addEventListener("abort", abort, { once: true });
    const finish = () => {
      signal.removeEventListener("abort", abort);
    };
    promise.then(
      (value) => {
        finish();
        resolve(value);
      },
      (error: unknown) => {
        finish();
        reject(errorFrom(error));
      },
    );
  });
}

export async function completeWithProviderRetry(
  complete: () => Promise<AssistantMessage>,
  options: {
    signal?: AbortSignal;
    delay: (milliseconds: number) => Promise<void>;
    onRetry?: (attempt: number, backoffMs: number) => void;
  },
): Promise<AssistantMessage> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await waitForAbort(complete(), options.signal);
    } catch (error: unknown) {
      if (
        !(error instanceof ProviderError) ||
        error.retryable !== true ||
        attempt >= MAX_PROVIDER_RETRIES
      ) {
        throw error;
      }
      const backoffMs = PROVIDER_RETRY_BASE_DELAY_MS * 2 ** attempt;
      options.onRetry?.(attempt + 1, backoffMs);
      await waitForAbort(options.delay(backoffMs), options.signal);
    }
  }
}
