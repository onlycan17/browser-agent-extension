import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function readManifest(): Promise<unknown> {
  const path = resolve(process.cwd(), "public/manifest.json");
  return JSON.parse(await readFile(path, "utf8"));
}

describe("extension manifest", () => {
  it("uses Manifest V3 with the minimum required permissions", async () => {
    const manifest = await readManifest();

    expect(manifest).toMatchObject({
      manifest_version: 3,
      minimum_chrome_version: "116",
      permissions: ["activeTab", "scripting", "sidePanel", "storage"],
      side_panel: { default_path: "sidepanel.html" },
    });
  });

  it("allows only fixed provider origins at install time", async () => {
    const manifest = await readManifest();

    expect(manifest).toMatchObject({
      host_permissions: [
        "http://192.168.10.105:3620/*",
        "https://api.openai.com/*",
        "https://api.anthropic.com/*",
        "https://openrouter.ai/*",
        "https://api.groq.com/*",
        "https://api.together.xyz/*",
        "https://api.deepseek.com/*",
        "https://api.mistral.ai/*",
        "https://api.x.ai/*",
      ],
      optional_host_permissions: ["https://*/*"],
    });
  });
});
