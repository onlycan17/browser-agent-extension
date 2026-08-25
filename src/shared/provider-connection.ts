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

export async function testProviderConnection(
  settings: SettingsSummary,
  testConnection: () => Promise<ConnectionTestResult>,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectionTestResult> {
  const probeSucceeded = await requestLocalNetworkAccess(settings, fetchImpl);
  try {
    return await testConnection();
  } catch (error: unknown) {
    if (
      !probeSucceeded &&
      error instanceof RuntimeRequestError &&
      error.code === "PROVIDER_UNREACHABLE"
    ) {
      throw new LocalNetworkAccessError();
    }
    throw error;
  }
}
