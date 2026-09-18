# Cursor Origin (VenLabs Vercel)

Josiah’s VenLabs Vercel account **only imports Cursor Origin git**, not GitHub.
This GitHub repo (`orholam/copyr`) stays the current source of truth until an
Origin copy exists. The SPA config is the same either way.

**The Fastify API still cannot run on Vercel.** Origin vs GitHub only changes
where Vercel clones from. API = Render / Fly / Railway (`Dockerfile.api`).

## Vercel from Origin (once the Origin repo exists)

1. Vercel → **New Project** → **Continue with Origin** (not GitHub).
2. Connect the Origin team that owns `copyr`. Origin repos are private; Vercel
   requires a **paid team** (not Hobby).
3. Import `{owner}/copyr`.
4. Root Directory: **empty** (recommended). Uses repo-root `vercel.json`
   (`outputDirectory: dist`). Do not set Root Directory to `apps/web` on a
   fresh import. See [`docs/DEPLOY.md`](DEPLOY.md).
5. Build env:
   ```bash
   VITE_API_URL=https://<api-host>
   VITE_WORKSPACE_SLUG=harbor-ventures
   ```

Clone URL: `https://origin.cursor.com/{owner}/copyr.git`  
Codebase UI: `https://cursor.com/codebase/{owner}/copyr`

`intelligence/` is gitignored and must not be pushed.

## Create the Origin repo (new_repo Origin agent)

This GitHub-bound cloud VM **cannot** create Origin (no `CURSOR_AUTH_TOKEN` /
`CURSOR_API_KEY`; stored logins disabled). Run from an Origin-authenticated
agent as the same Cursor user (Josiah / `shellartists@gmail.com`):

```bash
origin auth status
origin repo create copyr --default-branch main
# prints owner/copyr — record https://origin.cursor.com/{owner}/copyr
# and https://cursor.com/codebase/{owner}/copyr

git remote add cursor-origin https://origin.cursor.com/{owner}/copyr.git
# exclude intelligence/ (already in .gitignore)
git push -u cursor-origin cursor/supabase-vercel-wiring-590f:main
```

Prefer a **native** Origin repo (above), not `origin repo create-mirrored orholam/copyr`,
so Vercel’s Origin importer sees it as Origin-native.

Do not copy secrets. After push, import in Vercel as above.
