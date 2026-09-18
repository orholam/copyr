#!/usr/bin/env bash
# Build the Vite SPA from any Vercel Root Directory, then put dist where
# Vercel outputDirectory=dist looks (cwd) and where repo-root vercel.json copies.
set -euo pipefail
START_CWD="$(pwd)"
ROOT="$START_CWD"
while [ "$ROOT" != "/" ] && [ ! -f "$ROOT/pnpm-workspace.yaml" ]; do
  ROOT="$(dirname "$ROOT")"
done
if [ ! -f "$ROOT/pnpm-workspace.yaml" ]; then
  echo "Could not find monorepo root from $START_CWD" >&2
  exit 1
fi
cd "$ROOT"
pnpm --filter @copyr/web build
SRC="$ROOT/apps/web/dist"
if [ ! -d "$SRC" ]; then
  echo "Vite did not write $SRC" >&2
  ls -la "$ROOT/apps/web" >&2
  exit 1
fi
copy_dist() {
  local dest="$1"
  mkdir -p "$(dirname "$dest")"
  if [ -d "$dest" ] && [ "$(cd "$dest" && pwd)" = "$(cd "$SRC" && pwd)" ]; then
    return 0
  fi
  rm -rf "$dest"
  cp -a "$SRC" "$dest"
  echo "copied SPA -> $dest"
}
copy_dist "$ROOT/dist"
copy_dist "$START_CWD/dist"
copy_dist "$START_CWD/apps/web/dist"
