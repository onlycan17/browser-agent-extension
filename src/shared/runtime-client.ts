import type {
  RequestPayloadMap,
  RequestType,
  ResponseDataMap,
  RuntimeRequest,
  RuntimeResponse,
} from "./messages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseResponse<T>(value: unknown, id: string): RuntimeResponse<T> {
  if (!isRecord(value) || value.id !== id || typeof value.ok !== "boolean") {
    throw new RuntimeRequestError(
      "INVALID_RESPONSE",
      "The extension returned an invalid response.",
      false,
    );
  }
  if (value.ok) return { id, ok: true, data: value.data as T };
  if (!isRecord(value.error)) {
    throw new RuntimeRequestError(
      "INVALID_RESPONSE",
      "The extension returned an invalid error.",
      false,
    );
  }
  const { code, message, retryable } = value.error;
  if (typeof code !== "string" || typeof message !== "string" || typeof retryable !== "boolean") {
    throw new RuntimeRequestError(
      "INVALID_RESPONSE",
      "The extension returned an invalid error.",
      false,
    );
  }
  return { id, ok: false, error: { code, message, retryable } };
}

export class RuntimeRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RuntimeRequestError";
  }
}

async function sendMessage<T extends RequestType>(request: RuntimeRequest<T>): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(request);
  } catch {
    throw new RuntimeRequestError(
      "RUNTIME_UNAVAILABLE",
      "확장 프로그램과의 연결이 끊겼습니다. 확장을 다시 로드한 뒤 재시도해 주세요.",
      true,
    );
  }
}

export async function sendRuntimeRequest<T extends RequestType>(
  type: T,
  payload: RequestPayloadMap[T],
): Promise<ResponseDataMap[T]> {
  const id = crypto.randomUUID();
  const request: RuntimeRequest<T> = { id, type, payload };
  const rawResponse = await sendMessage(request);
  const response = parseResponse<ResponseDataMap[T]>(rawResponse, id);
  if (!response.ok) {
    throw new RuntimeRequestError(
      response.error.code,
      response.error.message,
      response.error.retryable,
    );
  }
  return response.data;
}
