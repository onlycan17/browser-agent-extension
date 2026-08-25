import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDER_IDS } from "../src/shared/providers";

async function settingsDocument(): Promise<Document> {
  const html = await readFile(resolve(process.cwd(), "public/settings.html"), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

describe("provider settings UI", () => {
  it("offers every registered provider in registry order", async () => {
    const document = await settingsDocument();
    const values = Array.from(document.querySelectorAll<HTMLSelectElement>("#provider option")).map(
      (option) => option.value,
    );

    expect(values).toEqual(PROVIDER_IDS);
  });

  it("includes Custom endpoint permission and credential guidance", async () => {
    const document = await settingsDocument();

    expect(document.querySelector("#custom-warning")?.textContent).toContain("HTTPS endpoint");
    expect(document.querySelector("#base-url-help")).not.toBeNull();
    expect(document.querySelector("#provider-key-help")).not.toBeNull();
  });
});
