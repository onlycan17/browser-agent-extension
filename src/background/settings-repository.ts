import {
  DEFAULT_SETTINGS,
  parseProviderSettings,
  type ProviderSettings,
  type SettingsSummary,
  type ValidationResult,
  withoutApiKey,
} from "../shared/settings";
import { isProviderId, type ProviderId } from "../shared/providers";

const SETTINGS_KEY = "browserAgent.settings";
const API_KEY = "browserAgent.apiKey";

interface StorageAreaLike {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel?(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void>;
}

interface StoredApiKey {
  value: string;
  provider: ProviderId;
  origin: string;
}

interface PublicSettingsState {
  settings: ProviderSettings;
  valid: boolean;
}

function credentialOrigin(settings: ProviderSettings): string {
  return new URL(settings.baseUrl).origin;
}

function sharesCredentialScope(current: ProviderSettings, next: ProviderSettings): boolean {
  if (current.provider !== next.provider) return false;
  if (next.provider !== "custom") return true;
  return credentialOrigin(current) === credentialOrigin(next);
}

function parseStoredApiKey(value: unknown): StoredApiKey | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.value !== "string" || record.value.length === 0) return null;
  if (!isProviderId(record.provider) || typeof record.origin !== "string") return null;
  try {
    return new URL(record.origin).origin === record.origin
      ? { value: record.value, provider: record.provider, origin: record.origin }
      : null;
  } catch {
    return null;
  }
}

function storedApiKey(value: string, settings: ProviderSettings): StoredApiKey {
  return { value, provider: settings.provider, origin: credentialOrigin(settings) };
}

function secretMatches(secret: StoredApiKey, settings: ProviderSettings): boolean {
  if (secret.provider !== settings.provider) return false;
  return secret.origin === credentialOrigin(settings);
}

export class SettingsRepository {
  constructor(
    private readonly local: StorageAreaLike,
    private readonly session: StorageAreaLike,
  ) {}

  async restrictSecretAccess(): Promise<void> {
    await this.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    await this.session.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
  }

  async loadRuntime(): Promise<ProviderSettings> {
    const state = await this.readPublicSettings();
    const apiKey = await this.readApiKey(state.valid ? state.settings : null);
    return apiKey === undefined ? state.settings : { ...state.settings, apiKey };
  }

  async loadSummary(): Promise<SettingsSummary> {
    const settings = await this.loadRuntime();
    return { ...withoutApiKey(settings), hasApiKey: settings.apiKey !== undefined };
  }

  async save(value: unknown): Promise<ValidationResult<SettingsSummary>> {
    const parsed = parseProviderSettings(value);
    if (!parsed.ok) return parsed;
    const currentState = await this.readPublicSettings();
    const currentKey = await this.readApiKey(currentState.valid ? currentState.settings : null);
    const keepCurrentKey =
      currentState.valid && sharesCredentialScope(currentState.settings, parsed.value);
    const apiKey = parsed.value.apiKey ?? (keepCurrentKey ? currentKey : undefined);
    const publicSettings = withoutApiKey(parsed.value);
    await this.local.set({ [SETTINGS_KEY]: publicSettings });
    await this.replaceApiKey(apiKey, parsed.value);
    return { ok: true, value: { ...publicSettings, hasApiKey: apiKey !== undefined } };
  }

  async clearApiKey(): Promise<void> {
    await Promise.all([this.local.remove(API_KEY), this.session.remove(API_KEY)]);
  }

  private async readPublicSettings(): Promise<PublicSettingsState> {
    const stored = await this.local.get(SETTINGS_KEY);
    const parsed = parseProviderSettings(stored[SETTINGS_KEY]);
    return parsed.ok
      ? { settings: parsed.value, valid: true }
      : { settings: { ...DEFAULT_SETTINGS }, valid: false };
  }

  private async readSecret(
    area: StorageAreaLike,
    settings: ProviderSettings | null,
  ): Promise<string | undefined> {
    const stored = (await area.get(API_KEY))[API_KEY];
    if (stored === undefined) return undefined;
    const secret = parseStoredApiKey(stored);
    if (secret !== null && settings !== null && secretMatches(secret, settings))
      return secret.value;
    await area.remove(API_KEY);
    return undefined;
  }

  private async readApiKey(settings: ProviderSettings | null): Promise<string | undefined> {
    const [sessionSecret, localSecret] = await Promise.all([
      this.readSecret(this.session, settings),
      this.readSecret(this.local, settings),
    ]);
    return sessionSecret ?? localSecret;
  }

  private async replaceApiKey(
    apiKey: string | undefined,
    settings: ProviderSettings,
  ): Promise<void> {
    await this.clearApiKey();
    if (apiKey === undefined || apiKey.length === 0) return;
    const target = settings.rememberApiKey ? this.local : this.session;
    await target.set({ [API_KEY]: storedApiKey(apiKey, settings) });
  }
}
