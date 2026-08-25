import { describe, expect, it } from "vitest";
import { SettingsRepository } from "../src/background/settings-repository";
import { DEFAULT_LOCAL_MODEL, LOCAL_BASE_URL, OPENAI_BASE_URL } from "../src/shared/settings";

class MemoryStorage {
  readonly values = new Map<string, unknown>();
  accessLevel: string | undefined;

  get(keys: string | string[]): Promise<Record<string, unknown>> {
    const names = Array.isArray(keys) ? keys : [keys];
    const values = Object.fromEntries(names.map((key) => [key, this.values.get(key)]));
    return Promise.resolve(values);
  }

  set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) this.values.set(key, value);
    return Promise.resolve();
  }

  remove(keys: string | string[]): Promise<void> {
    const names = Array.isArray(keys) ? keys : [keys];
    for (const key of names) this.values.delete(key);
    return Promise.resolve();
  }

  setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" }): Promise<void> {
    this.accessLevel = options.accessLevel;
    return Promise.resolve();
  }
}

function createRepository() {
  const local = new MemoryStorage();
  const session = new MemoryStorage();
  return { local, repository: new SettingsRepository(local, session), session };
}

const localSettings = {
  provider: "local",
  baseUrl: LOCAL_BASE_URL,
  model: DEFAULT_LOCAL_MODEL,
  rememberApiKey: false,
  maxAgentSteps: 8,
};

describe("SettingsRepository", () => {
  it("returns secure local defaults without a secret", async () => {
    const { repository } = createRepository();

    await expect(repository.loadSummary()).resolves.toEqual({
      ...localSettings,
      hasApiKey: false,
    });
  });

  it("clears an unscoped legacy secret instead of attaching it to defaults", async () => {
    const { repository, session } = createRepository();
    session.values.set("browserAgent.apiKey", "legacy-cloud-secret");

    const settings = await repository.loadRuntime();

    expect(settings).toEqual(localSettings);
    expect(session.values.has("browserAgent.apiKey")).toBe(false);
  });

  it("stores session secrets without exposing their value", async () => {
    const { local, repository, session } = createRepository();

    const result = await repository.save({ ...localSettings, apiKey: "local-token" });

    expect(result).toMatchObject({ ok: true, value: { hasApiKey: true } });
    expect(session.values.get("browserAgent.apiKey")).toEqual({
      value: "local-token",
      provider: "local",
      origin: "http://192.168.10.105:3620",
    });
    expect(local.values.has("browserAgent.apiKey")).toBe(false);
    expect(JSON.stringify(result)).not.toContain("local-token");
  });

  it("moves an existing same-provider key when persistent storage is enabled", async () => {
    const { local, repository, session } = createRepository();
    const openAiSettings = {
      provider: "openai",
      baseUrl: OPENAI_BASE_URL,
      model: "gpt-4.1-mini",
      rememberApiKey: false,
      maxAgentSteps: 6,
    };
    await repository.save({ ...openAiSettings, apiKey: "openai-secret" });

    const result = await repository.save({ ...openAiSettings, rememberApiKey: true });

    expect(result.ok).toBe(true);
    expect(local.values.get("browserAgent.apiKey")).toEqual({
      value: "openai-secret",
      provider: "openai",
      origin: "https://api.openai.com",
    });
    expect(session.values.has("browserAgent.apiKey")).toBe(false);
  });

  it("clears an existing key when the provider changes", async () => {
    const { local, repository, session } = createRepository();
    await repository.save({
      provider: "openai",
      baseUrl: OPENAI_BASE_URL,
      model: "gpt-4.1-mini",
      rememberApiKey: true,
      maxAgentSteps: 6,
      apiKey: "openai-secret",
    });

    const result = await repository.save(localSettings);

    expect(result).toMatchObject({ ok: true, value: { provider: "local", hasApiKey: false } });
    expect(local.values.has("browserAgent.apiKey")).toBe(false);
    expect(session.values.has("browserAgent.apiKey")).toBe(false);
    await expect(repository.loadRuntime()).resolves.not.toHaveProperty("apiKey");
  });

  it("clears a Custom key when the endpoint origin changes", async () => {
    const { repository } = createRepository();
    const customSettings = {
      provider: "custom" as const,
      baseUrl: "https://first.example.com/v1",
      model: "example-model",
      rememberApiKey: false,
      maxAgentSteps: 6,
    };
    await repository.save({ ...customSettings, apiKey: "first-origin-secret" });

    const result = await repository.save({
      ...customSettings,
      baseUrl: "https://second.example.com/v1",
    });

    expect(result).toMatchObject({ ok: true, value: { hasApiKey: false } });
    await expect(repository.loadRuntime()).resolves.not.toHaveProperty("apiKey");
  });

  it("keeps a Custom key when only the path changes on the same origin", async () => {
    const { repository } = createRepository();
    const customSettings = {
      provider: "custom" as const,
      baseUrl: "https://llm.example.com/v1",
      model: "example-model",
      rememberApiKey: false,
      maxAgentSteps: 6,
    };
    await repository.save({ ...customSettings, apiKey: "same-origin-secret" });

    const result = await repository.save({
      ...customSettings,
      baseUrl: "https://llm.example.com/v2",
    });

    expect(result).toMatchObject({ ok: true, value: { hasApiKey: true } });
    await expect(repository.loadRuntime()).resolves.toMatchObject({ apiKey: "same-origin-secret" });
  });

  it("clears a scoped key when public settings are missing", async () => {
    const { local, repository } = createRepository();
    await repository.save({
      provider: "openai",
      baseUrl: OPENAI_BASE_URL,
      model: "gpt-4.1-mini",
      rememberApiKey: true,
      maxAgentSteps: 6,
      apiKey: "orphaned-openai-key",
    });
    local.values.delete("browserAgent.settings");

    const settings = await repository.loadRuntime();

    expect(settings).toEqual(localSettings);
    expect(local.values.has("browserAgent.apiKey")).toBe(false);
  });

  it("clears a key when Custom public settings are corrupted", async () => {
    const { local, repository, session } = createRepository();
    await repository.save({
      provider: "custom",
      baseUrl: "https://llm.example.com/v1",
      model: "example-model",
      rememberApiKey: false,
      maxAgentSteps: 6,
      apiKey: "orphaned-custom-key",
    });
    local.values.set("browserAgent.settings", {
      provider: "custom",
      baseUrl: "http://llm.example.com/v1",
      model: "example-model",
      rememberApiKey: false,
      maxAgentSteps: 6,
    });

    const settings = await repository.loadRuntime();

    expect(settings).toEqual(localSettings);
    expect(session.values.has("browserAgent.apiKey")).toBe(false);
  });

  it("restricts both storage areas to trusted extension contexts", async () => {
    const { local, repository, session } = createRepository();

    await repository.restrictSecretAccess();

    expect(local.accessLevel).toBe("TRUSTED_CONTEXTS");
    expect(session.accessLevel).toBe("TRUSTED_CONTEXTS");
  });

  it("does not modify storage when validation fails", async () => {
    const { local, repository, session } = createRepository();

    const result = await repository.save({ ...localSettings, maxAgentSteps: 50 });

    expect(result.ok).toBe(false);
    expect(local.values.size).toBe(0);
    expect(session.values.size).toBe(0);
  });
});
