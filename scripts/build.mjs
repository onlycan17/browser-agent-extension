import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "dist");
const sharedOptions = {
  bundle: true,
  legalComments: "none",
  logLevel: "silent",
  minify: false,
  sourcemap: false,
  target: "chrome116",
};

async function bundleModules() {
  return build({
    ...sharedOptions,
    entryPoints: {
      background: resolve(root, "src/background/index.ts"),
      settings: resolve(root, "src/settings/index.ts"),
      sidepanel: resolve(root, "src/sidepanel/index.ts"),
    },
    format: "esm",
    outdir,
  });
}

async function copyPdfAssets() {
  await Promise.all([
    cp(
      resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
      resolve(outdir, "pdf.worker.mjs"),
    ),
    cp(resolve(root, "node_modules/pdfjs-dist/cmaps"), resolve(outdir, "cmaps"), {
      recursive: true,
    }),
  ]);
}

async function validatePdfAssets() {
  const worker = await stat(resolve(outdir, "pdf.worker.mjs"));
  const cmaps = await readdir(resolve(outdir, "cmaps"));
  if (worker.size === 0 || cmaps.length === 0) {
    throw new Error("PDF.js runtime assets are incomplete.");
  }
}

async function bundleContentScript() {
  return build({
    ...sharedOptions,
    entryPoints: [resolve(root, "src/content/index.ts")],
    format: "iife",
    outfile: resolve(outdir, "content.js"),
  });
}

async function listSkillFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listSkillFiles(full)));
    else if (entry.name.endsWith(".md")) files.push(full);
  }
  return files.sort();
}

async function bundleSkills() {
  const sourceDir = resolve(root, "skills");
  await cp(sourceDir, resolve(outdir, "skills"), { recursive: true });
  const skillFiles = await listSkillFiles(sourceDir);
  const relative = skillFiles.map((file) => `skills/${file.slice(sourceDir.length + 1)}`);
  if (!relative.some((file) => file.endsWith("SKILL.md"))) {
    throw new Error("The skills directory has no SKILL.md entries.");
  }
  await writeFile(
    resolve(outdir, "skills", "index.json"),
    `${JSON.stringify(relative, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  await rm(outdir, { force: true, recursive: true });
  await mkdir(outdir, { recursive: true });
  await cp(resolve(root, "public"), outdir, { recursive: true });
  const [moduleResult, contentResult] = await Promise.all([
    bundleModules(),
    bundleContentScript(),
    copyPdfAssets(),
    bundleSkills(),
  ]);
  const warnings = [moduleResult, contentResult].flatMap((result) => result.warnings);
  if (warnings.length > 0) throw new Error("Build completed with warnings.");
  await validatePdfAssets();
}

await main();
