import { chromium } from "playwright";
import { mkdirSync, copyFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const ROOT = "/home/josiaha/Repos/copyr";
const OUT = join(ROOT, "artifacts");
const VID = join(OUT, "playwright-video");
mkdirSync(VID, { recursive: true });
for (const f of readdirSync(VID)) {
  try { unlinkSync(join(VID, f)); } catch {}
}

const BASE = "http://127.0.0.1:5173";
const API = "https://copyr.onrender.com";
const email = `demo+${randomBytes(3).toString("hex")}@example.com`;
const password = `Demo-${randomBytes(4).toString("hex")}!aA1`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VID, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  console.log("Recording full demo", BASE, email);

  // ── sign up ──────────────────────────────────────────────────────
  await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/passcode/i).fill("hardtech");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL(/\/auth/);
  await page.goto(`${BASE}/auth/sign-up`, { waitUntil: "domcontentloaded" });
  if (await page.getByPlaceholder(/passcode/i).count()) {
    await page.getByPlaceholder(/passcode/i).fill("hardtech");
    await page.getByRole("button", { name: /continue/i }).click();
    await sleep(400);
    await page.goto(`${BASE}/auth/sign-up`, { waitUntil: "domcontentloaded" });
  }
  await page.getByPlaceholder("Ada Lovelace").fill("Demo Partner");
  await page.getByPlaceholder("you@firm.vc").fill(email);
  await page.getByPlaceholder("Harbor Ventures").fill("Clarity Ventures");
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill(password);
  await pw.nth(1).fill(password);
  await page.getByRole("button", { name: /sign up with email/i }).click();
  await page.waitForURL(/\/app/, { timeout: 60_000 });
  await page.waitForFunction(
    () => (document.body?.innerText || "").includes("Clarity Ventures") && (document.body?.innerText || "").includes("500"),
    { timeout: 45_000 },
  );
  await sleep(1200);

  // ── Agents page (no workflows list) ──────────────────────────────
  await page.goto(`${BASE}/app/automations`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /^Agents$/i }).waitFor({ timeout: 20_000 });
  await sleep(2000);
  await page.getByText(/Judgment engines/i).first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(1500);

  // ── Workflows page + templates toggle (not always-on) ────────────
  await page.goto(`${BASE}/app/workflows`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /^Workflows$/i }).waitFor({ timeout: 20_000 });
  await sleep(1500);
  await page.getByRole("button", { name: /^Templates$/i }).click();
  await sleep(1500);
  await page.getByText(/Start from a template/i).waitFor();
  await sleep(1200);
  await page.getByRole("button", { name: /^Templates$/i }).click(); // hide again
  await sleep(800);

  // Open Diligence kickoff in compact modal
  const dilCard = page.getByText(/Diligence kickoff/i).first();
  if (await dilCard.count()) {
    await dilCard.click();
    await sleep(2500); // show compact dotted canvas
    // close modal
    const close = page.getByRole("button", { name: /cancel|close|esc/i }).first();
    if (await close.count()) await close.click();
    else await page.keyboard.press("Escape");
    await sleep(800);
  }

  // Create a tiny custom workflow via New
  await page.getByRole("button", { name: /^New$/i }).click();
  await sleep(1000);
  const nameInput = page.getByPlaceholder(/name|workflow/i).first();
  if (await nameInput.count()) {
    await nameInput.fill("Ping on DD");
  } else {
    // builder may use unlabeled input — try first text input in modal
    const inputs = page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])');
    if (await inputs.count()) await inputs.first().fill("Ping on DD");
  }
  await sleep(2000);
  await page.keyboard.press("Escape");
  await sleep(600);

  // ── Trigger diligence run via in-page API (same session) ─────────
  const companyId = await page.evaluate(async (API) => {
    const getToken = () => {
      for (const k of Object.keys(localStorage)) {
        try {
          const v = JSON.parse(localStorage.getItem(k) || "");
          const t = v?.access_token || v?.currentSession?.access_token;
          if (t) return t;
        } catch {}
      }
      return null;
    };
    const token = getToken();
    const slug = localStorage.getItem("copyr-workspace-slug");
    const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (slug) h["x-workspace-slug"] = slug;
    const j = async (path, init) => {
      const r = await fetch(`${API}/api/v1${path}`, { ...init, headers: { ...h, ...(init?.headers || {}) } });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(`${path} ${r.status} ${JSON.stringify(body)}`);
      return body;
    };
    // ensure single diligence workflow (patch existing, don't duplicate)
    const wfs = await j("/workflows");
    const list = Array.isArray(wfs) ? wfs : wfs.workflows || [];
    const dil = list.find((w) => /diligence kickoff/i.test(w.name));
    if (dil) {
      await j(`/workflows/${dil.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          actions: [{ type: "run_agent", config: { agentName: "Diligence Checklist Builder" } }],
          isEnabled: true,
        }),
      });
    }
    const c = await j("/companies", {
      method: "POST",
      body: JSON.stringify({
        name: "OpenLoop Robotics",
        sector: "Robotics",
        description: "Warehouse autonomy for mid-market logistics.",
      }),
    });
    const pipes = await j("/pipelines");
    const stages = (Array.isArray(pipes) ? pipes : pipes.items || []).flatMap((p) => p.stages || []);
    const dd = stages.find((s) => /due diligence/i.test(s.name));
    await j(`/deals/${c.id}`, { method: "PATCH", body: JSON.stringify({ stageId: dd.id }) });
    // wait until agent completed with tasks
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const ov = await j("/automations/overview");
      const run = (ov.runs || []).find((r) => r.name === "Diligence Checklist Builder" && r.status === "completed");
      const notes = await j(`/notes?companyId=${c.id}`);
      const noteList = Array.isArray(notes) ? notes : notes.items || [];
      if (run && noteList.some((n) => /diligence tasks/i.test(n.body || ""))) return c.id;
    }
    return c.id;
  }, API);
  console.log("company", companyId);

  // Brief Agents → Runs so we see the completed run
  await page.goto(`${BASE}/app/automations`, { waitUntil: "domcontentloaded" });
  await sleep(1000);
  const runsTab = page.getByRole("button", { name: /Recent runs/i }).or(page.getByText(/^Recent runs$/i));
  if (await runsTab.count()) await runsTab.first().click();
  await sleep(2500);

  // Company page — checklist + timeline
  await page.goto(`${BASE}/app/companies/${companyId}`, { waitUntil: "domcontentloaded" });
  await page.getByText(/OpenLoop Robotics/i).first().waitFor({ timeout: 30_000 });
  await sleep(1500);

  let hits = 0;
  for (let i = 0; i < 20; i++) {
    hits = await page.getByText(/Diligence checklist|diligence tasks|Customer reference/i).count();
    console.log("poll", i, "hits", hits);
    if (hits > 0) break;
    await sleep(2000);
  }
  const box = page.getByText(/Diligence checklist/i);
  if (await box.count()) {
    await box.first().scrollIntoViewIfNeeded();
    await sleep(2000);
  }
  const note = page.getByText(/provisioned \d+ open diligence|added \d+ diligence/i);
  if (await note.count()) {
    await note.first().scrollIntoViewIfNeeded();
    await sleep(1500);
  }
  const tl = page.getByText(/^Timeline$/i);
  if (await tl.count()) await tl.first().scrollIntoViewIfNeeded();
  await sleep(2500);
  // scroll checklist tasks into view again
  if (await box.count()) await box.first().scrollIntoViewIfNeeded();
  await sleep(2000);

  const video = await page.video()?.path();
  await context.close();
  await browser.close();
  if (!video) throw new Error("no video");
  const webm = join(OUT, "workflow-ux-demo.webm");
  const mp4 = join(OUT, "workflow-ux-demo.mp4");
  copyFileSync(video, webm);
  execSync(
    `ffmpeg -y -i ${JSON.stringify(webm)} -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${JSON.stringify(mp4)}`,
    { stdio: "inherit" },
  );
  console.log("Wrote", mp4, "hits", hits);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
