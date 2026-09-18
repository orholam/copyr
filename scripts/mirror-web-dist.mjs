#!/usr/bin/env node
/**
 * Copy Vite's apps/web/dist to every location Vercel may expect:
 * repo-root dist (empty Root Directory), INIT_CWD/dist (Root Directory
 * apps/api or apps/web), and INIT_CWD/apps/web/dist so a dashboard
 * build command of `cp -a apps/web/dist dist` still works.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(repoRoot, "apps/web/dist");

if (!existsSync(src) || !statSync(src).isDirectory()) {
  console.error(`Vite outDir missing: ${src}`);
  process.exit(1);
}

function mirror(dest) {
  const resolved = resolve(dest);
  if (resolved === resolve(src)) return;
  mkdirSync(dirname(resolved), { recursive: true });
  rmSync(resolved, { recursive: true, force: true });
  cpSync(src, resolved, { recursive: true });
  console.log(`mirrored SPA dist -> ${resolved}`);
}

mirror(join(repoRoot, "dist"));

const launchCwd = resolve(process.env.INIT_CWD || process.cwd());
mirror(join(launchCwd, "dist"));
mirror(join(launchCwd, "apps/web/dist"));
