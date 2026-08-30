import { describe, expect, it, vi } from "vitest";
import {
  MAX_AUTO_SKILLS,
  SkillService,
  type SkillFileAdapter,
} from "../src/background/skill-service";

function skillFile(
  name: string,
  description: string,
  options: { keywords?: string[]; urls?: string[]; body?: string } = {},
): string {
  const keywords =
    options.keywords === undefined
      ? ""
      : `  keywords: [${options.keywords.map((keyword) => `"${keyword}"`).join(", ")}]\n`;
  const urls =
    options.urls === undefined
      ? ""
      : `  url: [${options.urls.map((url) => `"${url}"`).join(", ")}]\n`;
  return `---\nname: ${name}\ndescription: ${description}\nautoInject:\n${keywords}${urls}---\n${options.body ?? "guidance body"}`;
}

function adapter(files: Record<string, string>): SkillFileAdapter {
  return {
    list: () => Promise.resolve(Object.keys(files)),
    fetch: (path) => {
      const value = files[path];
      return value === undefined
        ? Promise.reject(new Error("missing file"))
        : Promise.resolve(value);
    },
  };
}

describe("SkillService", () => {
  it("builds a cached catalog from bundled skill files", async () => {
    const fetch = vi.fn((path: string) => Promise.resolve(skillFile(path, "desc", {})));
    const service = new SkillService({
      list: () => Promise.resolve(["skills/builtin/a/SKILL.md", "skills/builtin/b/SKILL.md"]),
      fetch,
    });

    await expect(service.catalog()).resolves.toHaveLength(2);
    await expect(service.catalog()).resolves.toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("skips files without valid frontmatter", async () => {
    const service = new SkillService(
      adapter({
        "skills/builtin/good/SKILL.md": skillFile("good", "Good skill.", {}),
        "skills/builtin/bad/SKILL.md": "no frontmatter here",
      }),
    );

    await expect(service.catalog()).resolves.toMatchObject([
      { name: "good", description: "Good skill." },
    ]);
  });

  it("loads skill content by exact name and rejects unknown names", async () => {
    const service = new SkillService(
      adapter({ "skills/builtin/youtube/SKILL.md": skillFile("youtube", "Video guidance.", {}) }),
    );

    await expect(service.content("youtube")).resolves.toMatchObject({ name: "youtube" });
    await expect(service.content("YouTube")).resolves.toMatchObject({ name: "youtube" });
    await expect(service.content("unknown")).resolves.toBeNull();
  });

  it("auto-injects at most two matched skills", async () => {
    const files: Record<string, string> = {
      "skills/builtin/youtube/SKILL.md": skillFile("youtube", "Video.", { keywords: ["youtube"] }),
      "skills/builtin/gh/SKILL.md": skillFile("gh", "Repo.", { urls: ["github.com"] }),
      "skills/builtin/x/SKILL.md": skillFile("x", "Post.", { keywords: ["twitter"] }),
      "skills/builtin/other/SKILL.md": skillFile("other", "Other.", {}),
    };
    const service = new SkillService(adapter(files));

    const matched = await service.autoInjectSkills("https://gist.github.com/x", "youtube posting");

    expect(matched.map((skill) => skill.name)).toEqual(["youtube", "gh"]);
    expect(matched).toHaveLength(MAX_AUTO_SKILLS);
    expect(matched.every((skill) => skill.content === "guidance body")).toBe(true);
  });

  it("bounds loaded skill content", async () => {
    const service = new SkillService(
      adapter({
        "skills/builtin/big/SKILL.md": skillFile("big", "Big skill.", {
          body: "x".repeat(MAX_SKILL_TEST_OVER),
        }),
      }),
    );

    const loaded = await service.content("big");

    expect(loaded?.content.length).toBeLessThanOrEqual(16_000);
  });
});

const MAX_SKILL_TEST_OVER = 20_000;
