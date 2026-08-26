import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeRequestError, sendRuntimeRequest } from "../src/shared/runtime-client";

describe("runtime request client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps a closed Chrome message channel to a stable retryable error", async () => {
    vi.stubGlobal("chrome", {
      runtime: { sendMessage: vi.fn().mockRejectedValue(new Error("The message port closed")) },
    });

    const request = sendRuntimeRequest("SETTINGS_GET", {});

    await expect(request).rejects.toMatchObject({
      name: "RuntimeRequestError",
      code: "RUNTIME_UNAVAILABLE",
      retryable: true,
    });
    await expect(request).rejects.toBeInstanceOf(RuntimeRequestError);
  });
});
