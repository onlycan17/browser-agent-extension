import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

async function bundleContentScript() {
  return build({
    ...sharedOptions,
    entryPoints: [resolve(root, "src/content/index.ts")],
    format: "iife",
    outfile: resolve(outdir, "content.js"),
  });
}

async function main() {
  await rm(outdir, { force: true, recursive: true });
  await mkdir(outdir, { recursive: true });
  await cp(resolve(root, "public"), outdir, { recursive: true });
  const results = await Promise.all([bundleModules(), bundleContentScript()]);
  const warnings = results.flatMap((result) => result.warnings);
  if (warnings.length > 0) throw new Error("Build completed with warnings.");
}

await main();
