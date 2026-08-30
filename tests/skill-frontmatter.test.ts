import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter, skillMatchesPage } from "../src/shared/skill-frontmatter";

async function readSourceSkill(): Promise<string> {
  return readFile(resolve(process.cwd(), "skills/builtin/youtube/SKILL.md"), "utf8");
}

describe("skill frontmatter", () => {
  it("parses the bundled skill format including autoInject lists", async () => {
    const skill = parseSkillFrontmatter(await readSourceSkill());

    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("youtube");
    expect(skill?.description.length).toBeGreaterThan(10);
    expect(skill?.keywords).toContain("youtube");
    expect(skill?.keywords).toContain("video transcript");
  });

  it("returns null when name or description is missing", () => {
    expect(parseSkillFrontmatter("---\nname: only-name\n---\nbody")).toBeNull();
    expect(parseSkillFrontmatter("no frontmatter")).toBeNull();
  });

  it("matches a skill by url host including subdomains", () => {
    const skill = parseSkillFrontmatter(
      '---\nname: github\ndescription: GitHub guidance.\nautoInject:\n  url: ["github.com"]\n---\nbody',
    );
    expect(skill).not.toBeNull();

    expect(
      skillMatchesPage(
        skill ?? { name: "", description: "", keywords: [], urls: [] },
        "https://github.com/x",
        "",
      ),
    ).toBe(true);
    expect(
      skillMatchesPage(
        skill ?? { name: "", description: "", keywords: [], urls: [] },
        "https://gist.github.com/x",
        "",
      ),
    ).toBe(true);
    expect(
      skillMatchesPage(
        skill ?? { name: "", description: "", keywords: [], urls: [] },
        "https://not-github.com/x",
        "",
      ),
    ).toBe(false);
  });

  it("matches a skill by keyword in the instruction", () => {
    const skill = parseSkillFrontmatter(
      '---\nname: youtube\ndescription: YouTube guidance.\nautoInject:\n  keywords: ["youtube"]\n---\nbody',
    );
    expect(skill).not.toBeNull();

    expect(
      skillMatchesPage(
        skill ?? { name: "", description: "", keywords: [], urls: [] },
        "https://example.com/",
        "유튜브(YOUTUBE) 요약해줘",
      ),
    ).toBe(true);
    expect(
      skillMatchesPage(
        skill ?? { name: "", description: "", keywords: [], urls: [] },
        "https://example.com/",
        "뉴스 정리해줘",
      ),
    ).toBe(false);
  });
});
