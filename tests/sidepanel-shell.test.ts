import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

async function readPublicFile(name: string): Promise<string> {
  return readFile(resolve(process.cwd(), "public", name), "utf8");
}

describe("Side Panel shell", () => {
  it("exposes one primary submit action and a conditional stop action", async () => {
    const html = await readPublicFile("sidepanel.html");

    expect(html).not.toContain('id="analyze-button"');
    expect(html.match(/type="submit"/g)).toHaveLength(1);
    expect(html).toContain('id="run-button"');
    expect(html).toContain('id="stop-button"');
    expect(html).toContain("disabled hidden");
  });

  it("explains that screenshot consent sends page context to an image-capable model", async () => {
    const html = await readPublicFile("sidepanel.html");

    expect(html).toContain("멀티모달 화면 분석 허용");
    expect(html).toContain("이미지 입력 지원 모델");
    expect(html).toContain("이 요청에서만");
  });
});
