import type { ProviderSettings, SettingsSummary } from "../shared/settings";

export interface HostPermissionsApi {
  contains: (permissions: { origins: string[] }) => Promise<boolean>;
  request: (permissions: { origins: string[] }) => Promise<boolean>;
  remove: (permissions: { origins: string[] }) => Promise<boolean>;
}

export interface HostPermissionGrant {
  granted: boolean;
  newlyGranted: boolean;
}

function customOriginPattern(
  settings: Pick<ProviderSettings, "provider" | "baseUrl">,
): string | null {
  if (settings.provider !== "custom") return null;
  try {
    return `${new URL(settings.baseUrl).origin}/*`;
  } catch {
    return null;
  }
}

export async function ensureProviderHostPermission(
  settings: ProviderSettings,
  permissions: HostPermissionsApi,
): Promise<HostPermissionGrant> {
  const origin = customOriginPattern(settings);
  if (origin === null) {
    return { granted: settings.provider !== "custom", newlyGranted: false };
  }
  const request = { origins: [origin] };
  if (await permissions.contains(request)) return { granted: true, newlyGranted: false };
  const granted = await permissions.request(request);
  return { granted, newlyGranted: granted };
}

export async function removeProviderHostPermission(
  settings: Pick<ProviderSettings, "provider" | "baseUrl">,
  permissions: HostPermissionsApi,
): Promise<void> {
  const origin = customOriginPattern(settings);
  if (origin !== null) await permissions.remove({ origins: [origin] });
}

export async function removeObsoleteProviderHostPermission(
  previous: SettingsSummary | null,
  current: SettingsSummary,
  permissions: HostPermissionsApi,
): Promise<void> {
  if (previous === null) return;
  const oldOrigin = customOriginPattern(previous);
  if (oldOrigin === null || oldOrigin === customOriginPattern(current)) return;
  await permissions.remove({ origins: [oldOrigin] });
}
