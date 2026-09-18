#!/usr/bin/env node
/**
 * Vercel looks for `dist` (or Build Output API v3) under the *project Root
 * Directory*, which for a Hobby/VenLabs Turborepo import is often an app
 * folder — not the repo root and not necessarily apps/web. The Vite build
 * only writes apps/web/dist. Copy that output to every place the collector
 * might look so the deploy does not depend on dashboard Root Directory.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webDir, "../..");
const webDist = resolve(webDir, "dist");
const indexHtml = resolve(webDist, "index.html");

if (!existsSync(indexHtml)) {
  console.error(`copyr: Vite did not write ${indexHtml}`);
  process.exit(1);
}

const boaConfig = JSON.stringify({
  version: 3,
  routes: [
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html" },
  ],
});

function copyDir(src, dest) {
  if (src === dest) return;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

function emitAt(targetDir) {
  copyDir(webDist, resolve(targetDir, "dist"));
  const boa = resolve(targetDir, ".vercel/output");
  copyDir(webDist, resolve(boa, "static"));
  mkdirSync(boa, { recursive: true });
  writeFileSync(resolve(boa, "config.json"), boaConfig);
  console.log(`copyr: emit dist + .vercel/output -> ${relative(repoRoot, targetDir) || "."}`);
}

const targets = new Set([repoRoot, webDir, process.cwd()]);
const appsDir = resolve(repoRoot, "apps");
if (existsSync(appsDir)) {
  for (const ent of readdirSync(appsDir, { withFileTypes: true })) {
    if (ent.isDirectory()) targets.add(resolve(appsDir, ent.name));
  }
}

for (const target of targets) {
  try {
    emitAt(target);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`copyr: skipped ${target} (${message})`);
  }
}

if (!existsSync(resolve(repoRoot, "dist/index.html"))) {
  console.error("copyr: repo-root dist/index.html missing after emit");
  process.exit(1);
}
