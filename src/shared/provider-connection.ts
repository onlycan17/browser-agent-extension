import type { ConnectionTestResult } from "./llm";
import { RuntimeRequestError } from "./runtime-client";
import type { SettingsSummary } from "./settings";

const LOCAL_NETWORK_MESSAGE =
  "The model provider could not be reached. Chrome의 로컬 네트워크 접근 권한과 모델 서버 상태를 확인해 주세요.";

export class LocalNetworkAccessError extends Error {
  constructor() {
    super(LOCAL_NETWORK_MESSAGE);
    this.name = "LocalNetworkAccessError";
  }
}

export async function requestLocalNetworkAccess(
  settings: SettingsSummary,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (settings.provider !== "local") return true;
  try {
    const response = await fetchImpl(`${settings.baseUrl}/models`, { cache: "no-store" });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

function needsLocalNetworkHint(probeSucceeded: boolean, error: unknown): boolean {
  return (
    !probeSucceeded && error instanceof RuntimeRequestError && error.code === "PROVIDER_UNREACHABLE"
  );
}

export async function runProviderRequest<T>(
  settings: SettingsSummary,
  request: () => Promise<T>,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const probeSucceeded = await requestLocalNetworkAccess(settings, fetchImpl);
  try {
    return await request();
  } catch (error: unknown) {
    if (needsLocalNetworkHint(probeSucceeded, error)) throw new LocalNetworkAccessError();
    throw error;
  }
}

export function testProviderConnection(
  settings: SettingsSummary,
  testConnection: () => Promise<ConnectionTestResult>,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTestResult> {
  return runProviderRequest(settings, testConnection, fetchImpl);
}
