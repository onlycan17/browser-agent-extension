export type ProviderErrorCode =
  "PROVIDER_UNREACHABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_REJECTED" | "MODEL_PROTOCOL_ERROR";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderRequestOptions {
  signal?: AbortSignal;
  timeoutMs: number;
}

function mapHttpError(status: number): ProviderError {
  const retryable = status === 408 || status === 429 || status >= 500;
  const message =
    status === 401 || status === 403
      ? "The provider rejected the API key."
      : "The provider rejected the request.";
  return new ProviderError("PROVIDER_REJECTED", message, retryable);
}

function timeoutError(): ProviderError {
  return new ProviderError("PROVIDER_TIMEOUT", "The provider request timed out.", true);
}

export function protocolError(): ProviderError {
  return new ProviderError(
    "MODEL_PROTOCOL_ERROR",
    "The model server returned an invalid response.",
    false,
  );
}

export class ProviderHttpClient {
  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async requestJson(
    url: string,
    init: RequestInit,
    options: ProviderRequestOptions,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timedOut = timeoutError();
    const abort = () => {
      controller.abort();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted === true) controller.abort(options.signal.reason);
    const timeout = setTimeout(() => {
      controller.abort(timedOut);
    }, options.timeoutMs);
    try {
      controller.signal.throwIfAborted();
      const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) throw mapHttpError(response.status);
      try {
        return await response.json();
      } catch (error: unknown) {
        if (error instanceof SyntaxError) throw protocolError();
        throw error;
      }
    } catch (error: unknown) {
      if (error instanceof ProviderError) throw error;
      if (controller.signal.reason === timedOut) throw timedOut;
      if (options.signal?.aborted === true) throw error;
      throw new ProviderError(
        "PROVIDER_UNREACHABLE",
        "The model provider could not be reached.",
        true,
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}
