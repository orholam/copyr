#!/usr/bin/env node
/**
 * Hobby Vite imports look for a directory named "dist" at the Vercel Root
 * Directory. The SPA lives in apps/web, so Vite writes apps/web/dist. When
 * Root Directory is empty (recommended), also mirror that folder to ./dist
 * at the repo root so the dashboard default still works.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webDist = resolve(webDir, "dist");
const repoDist = resolve(webDir, "../../dist");

if (!existsSync(resolve(webDist, "index.html"))) {
  console.error(`copyr: Vite did not write ${webDist}/index.html`);
  process.exit(1);
}

try {
  rmSync(repoDist, { recursive: true, force: true });
  cpSync(webDist, repoDist, { recursive: true });
  console.log(`copyr: mirrored ${webDist} -> ${repoDist}`);
  if (!existsSync(resolve(repoDist, "index.html"))) {
    console.error(`copyr: mirror did not produce ${repoDist}/index.html`);
    process.exit(1);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  // Root Directory = apps/web may forbid writing outside the app folder.
  console.warn(`copyr: skipped repo-root dist mirror (${message})`);
}
