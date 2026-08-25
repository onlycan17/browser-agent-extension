import { describe, expect, it, vi } from "vitest";
import {
  ensureProviderHostPermission,
  removeObsoleteProviderHostPermission,
  removeProviderHostPermission,
  type HostPermissionsApi,
} from "../src/settings/provider-permission";
import { OPENAI_BASE_URL } from "../src/shared/settings";

function permissionsApi(contains = false, request = true): HostPermissionsApi {
  return {
    contains: vi.fn(() => Promise.resolve(contains)),
    request: vi.fn(() => Promise.resolve(request)),
    remove: vi.fn(() => Promise.resolve(true)),
  };
}

const customSettings = {
  provider: "custom" as const,
  baseUrl: "https://llm.example.com/openai/v1",
  model: "example-model",
  rememberApiKey: false,
};

const openAiSummary = {
  provider: "openai" as const,
  baseUrl: OPENAI_BASE_URL,
  model: "gpt-4.1-mini",
  rememberApiKey: false,
  hasApiKey: false,
};

describe("custom provider host permission", () => {
  it("requests only the custom provider origin", async () => {
    const permissions = permissionsApi();

    await expect(ensureProviderHostPermission(customSettings, permissions)).resolves.toEqual({
      granted: true,
      newlyGranted: true,
    });

    expect(permissions.contains).toHaveBeenCalledWith({ origins: ["https://llm.example.com/*"] });
    expect(permissions.request).toHaveBeenCalledWith({ origins: ["https://llm.example.com/*"] });
  });

  it("does not request permission that is already granted", async () => {
    const permissions = permissionsApi(true);

    await expect(ensureProviderHostPermission(customSettings, permissions)).resolves.toEqual({
      granted: true,
      newlyGranted: false,
    });

    expect(permissions.request).not.toHaveBeenCalled();
  });

  it("surfaces a denied custom origin permission", async () => {
    const permissions = permissionsApi(false, false);

    await expect(ensureProviderHostPermission(customSettings, permissions)).resolves.toEqual({
      granted: false,
      newlyGranted: false,
    });
  });

  it("bypasses optional permissions for fixed providers", async () => {
    const permissions = permissionsApi();

    await expect(
      ensureProviderHostPermission({ ...openAiSummary, apiKey: "key" }, permissions),
    ).resolves.toEqual({ granted: true, newlyGranted: false });

    expect(permissions.contains).not.toHaveBeenCalled();
    expect(permissions.request).not.toHaveBeenCalled();
  });

  it("removes a newly granted Custom permission during rollback", async () => {
    const permissions = permissionsApi();

    await removeProviderHostPermission(customSettings, permissions);

    expect(permissions.remove).toHaveBeenCalledWith({ origins: ["https://llm.example.com/*"] });
  });

  it("removes the previous custom origin after provider changes", async () => {
    const permissions = permissionsApi();

    await removeObsoleteProviderHostPermission(
      { ...customSettings, hasApiKey: true },
      openAiSummary,
      permissions,
    );

    expect(permissions.remove).toHaveBeenCalledWith({ origins: ["https://llm.example.com/*"] });
  });

  it("keeps permission for the same custom origin", async () => {
    const permissions = permissionsApi();

    await removeObsoleteProviderHostPermission(
      { ...customSettings, hasApiKey: true },
      { ...customSettings, baseUrl: "https://llm.example.com/v2", hasApiKey: true },
      permissions,
    );

    expect(permissions.remove).not.toHaveBeenCalled();
  });
});
