import { describe, expect, it } from "vitest";
import {
  CLOUD_PROVIDER_TIMEOUT_MS,
  getProviderDefinition,
  isProviderId,
  PROVIDERS,
  PROVIDER_IDS,
} from "../src/shared/providers";

describe("provider registry", () => {
  it("contains one complete definition for every supported provider", () => {
    expect(PROVIDERS.map((provider) => provider.id)).toEqual(PROVIDER_IDS);
    expect(new Set(PROVIDERS.map((provider) => provider.baseUrl)).size).toBe(PROVIDERS.length);
  });

  it("marks only Anthropic as a native protocol", () => {
    expect(
      PROVIDERS.filter((provider) => provider.protocol === "anthropic").map(({ id }) => id),
    ).toEqual(["anthropic"]);
  });

  it("allows editing and optional permission only for Custom", () => {
    const custom = getProviderDefinition("custom");
    expect(custom).toMatchObject({
      editableBaseUrl: true,
      optionalHostPermission: true,
      timeoutMs: CLOUD_PROVIDER_TIMEOUT_MS,
    });
    expect(PROVIDERS.filter((provider) => provider.id !== "custom")).toSatisfy(
      (providers: typeof PROVIDERS) =>
        providers.every(
          (provider) => !provider.editableBaseUrl && !provider.optionalHostPermission,
        ),
    );
  });

  it("rejects unknown provider IDs", () => {
    expect(isProviderId("openrouter")).toBe(true);
    expect(isProviderId("gemini")).toBe(false);
    expect(isProviderId(null)).toBe(false);
  });
});
