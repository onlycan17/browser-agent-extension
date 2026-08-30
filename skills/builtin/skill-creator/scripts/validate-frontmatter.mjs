import { readFile } from 'node:fs/promises';

const filePath = process.argv[2];
if (!filePath) throw new Error('Usage: validate-frontmatter.mjs <SKILL.md>');

const frontmatter = (await readFile(filePath, 'utf-8')).match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
if (!frontmatter) throw new Error('Missing YAML frontmatter');

const invalidField = [...frontmatter.matchAll(/^(name|description|icon|library):[ \t]*(.*)$/gm)].find(([, , value]) => {
  try {
    return typeof JSON.parse(value) !== 'string';
  } catch {
    return true;
  }
})?.[1];
if (invalidField) throw new Error(`${invalidField} must be a valid double-quoted string`);
