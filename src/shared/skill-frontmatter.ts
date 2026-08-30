export interface SkillFrontmatter {
  name: string;
  description: string;
  keywords: string[];
  urls: string[];
}

export function parseSkillFrontmatter(source: string): SkillFrontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  const body = match?.[1];
  if (body === undefined) return null;
  const lines = body.split(/\r?\n/);
  const values = new Map<string, string>();
  let currentListKey: string | null = null;
  for (const line of lines) {
    const listItem = /^\s*-\s+"?([^"]+)"?\s*$/.exec(line);
    if (listItem !== null && currentListKey !== null) {
      const existing = values.get(currentListKey);
      values.set(
        currentListKey,
        `${existing === undefined ? "" : `${existing},`}${listItem[1]?.trim() ?? ""}`,
      );
      continue;
    }
    currentListKey = null;
    const pair = /^\s*([A-Za-z]+):\s*(.*)$/.exec(line);
    if (pair === null) continue;
    const key = pair[1] ?? "";
    const value = (pair[2] ?? "").trim();
    const inlineList = /^\[(.*)\]$/.exec(value);
    if (inlineList !== null) {
      const items = inlineList[1] ?? "";
      values.set(
        key,
        items
          .split(",")
          .map((item) => item.trim().replace(/^"|"$/g, ""))
          .filter((item) => item.length > 0)
          .join(","),
      );
      continue;
    }
    if (value.length === 0) {
      currentListKey = key;
      values.set(key, "");
      continue;
    }
    values.set(key, value.replace(/^"|"$/g, ""));
  }
  const name = values.get("name") ?? "";
  const description = values.get("description") ?? "";
  if (name.length === 0 || description.length === 0) return null;
  return {
    name,
    description,
    keywords: splitList(values.get("keywords")),
    urls: splitList(values.get("urls") ?? values.get("url")),
  };
}

function splitList(value: string | undefined): string[] {
  if (value === undefined || value.length === 0) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function skillMatchesPage(
  skill: SkillFrontmatter,
  pageUrl: string,
  instruction: string,
): boolean {
  const haystack = instruction.toLowerCase();
  if (skill.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) return true;
  try {
    const host = new URL(pageUrl).hostname.toLowerCase();
    return skill.urls.some(
      (pattern) => host === pattern.toLowerCase() || host.endsWith(`.${pattern.toLowerCase()}`),
    );
  } catch {
    return false;
  }
}
