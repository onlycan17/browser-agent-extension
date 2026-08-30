import { parseSkillFrontmatter, skillMatchesPage } from "../shared/skill-frontmatter";

export interface LoadedSkill {
  name: string;
  description: string;
  keywords: string[];
  urls: string[];
  content: string;
  path: string;
}

export interface SkillFileAdapter {
  list(): Promise<string[]>;
  fetch(path: string): Promise<string>;
}

export const MAX_SKILL_CONTENT_CHARS = 16_000;
export const MAX_AUTO_SKILLS = 2;

function skillBody(source: string): string {
  const bodyStart = source.indexOf("---", 3);
  if (source.startsWith("---") && bodyStart > 0) {
    const after = source.indexOf("\n", bodyStart + 1);
    return (after === -1 ? "" : source.slice(after + 1)).trim();
  }
  return source.trim();
}

export interface AgentSkillService {
  catalog(): Promise<readonly LoadedSkill[]>;
  content(name: string): Promise<LoadedSkill | null>;
  autoInjectSkills(pageUrl: string, instruction: string): Promise<readonly LoadedSkill[]>;
}

export class SkillService implements AgentSkillService {
  private cache: LoadedSkill[] | undefined;
  private loading: Promise<readonly LoadedSkill[]> | undefined;

  constructor(private readonly files: SkillFileAdapter) {}

  async catalog(): Promise<readonly LoadedSkill[]> {
    if (this.cache !== undefined) return this.cache;
    this.loading ??= this.loadAll();
    return this.loading;
  }

  async content(name: string): Promise<LoadedSkill | null> {
    const skills = await this.catalog();
    const lower = name.trim().toLowerCase();
    return skills.find((skill) => skill.name.toLowerCase() === lower) ?? null;
  }

  async autoInjectSkills(pageUrl: string, instruction: string): Promise<readonly LoadedSkill[]> {
    const skills = await this.catalog();
    return skills
      .filter((skill) => skillMatchesPage(skill, pageUrl, instruction))
      .slice(0, MAX_AUTO_SKILLS);
  }

  private async loadAll(): Promise<readonly LoadedSkill[]> {
    const paths = await this.files.list();
    const skills: LoadedSkill[] = [];
    for (const path of paths) {
      if (!path.startsWith("skills/") || !path.endsWith("SKILL.md")) continue;
      const source = await this.files.fetch(path);
      const frontmatter = parseSkillFrontmatter(source);
      if (frontmatter === null) continue;
      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        keywords: frontmatter.keywords,
        urls: frontmatter.urls,
        content: skillBody(source).slice(0, MAX_SKILL_CONTENT_CHARS),
        path,
      });
    }
    this.cache = skills;
    return skills;
  }
}

export function createRuntimeSkillAdapter(): SkillFileAdapter {
  return {
    list: async () => {
      const response = await fetch(chrome.runtime.getURL("skills/index.json"));
      const paths: unknown = await response.json();
      if (!Array.isArray(paths)) return [];
      return paths.filter((path): path is string => typeof path === "string");
    },
    fetch: async (path) => {
      const response = await fetch(chrome.runtime.getURL(path));
      return response.text();
    },
  };
}
