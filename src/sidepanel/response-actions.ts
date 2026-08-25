export type ResponseActionResult = "cancelled" | "copied" | "shared";

export interface ResponseActionEnvironment {
  readonly clipboard?: Pick<Clipboard, "writeText">;
  readonly share?: (data: ShareData) => Promise<void>;
}

export class ResponseActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseActionError";
  }
}

function browserEnvironment(): ResponseActionEnvironment {
  const environment: { clipboard?: Clipboard; share?: (data: ShareData) => Promise<void> } = {
    clipboard: navigator.clipboard,
  };
  if (typeof navigator.share === "function") {
    environment.share = (data) => navigator.share(data);
  }
  return environment;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

export async function copyResponse(
  body: string,
  environment: ResponseActionEnvironment = browserEnvironment(),
): Promise<ResponseActionResult> {
  if (!environment.clipboard) throw new ResponseActionError("클립보드를 사용할 수 없습니다.");
  try {
    await environment.clipboard.writeText(body);
    return "copied";
  } catch {
    throw new ResponseActionError("답변을 클립보드에 복사하지 못했습니다.");
  }
}

export async function shareResponse(
  title: string,
  body: string,
  environment: ResponseActionEnvironment = browserEnvironment(),
): Promise<ResponseActionResult> {
  if (!environment.share) return copyResponse(body, environment);
  try {
    await environment.share({ title: title || "Browser Agent 답변", text: body });
    return "shared";
  } catch (error: unknown) {
    if (isAbortError(error)) return "cancelled";
    throw new ResponseActionError("답변 공유를 완료하지 못했습니다.");
  }
}
