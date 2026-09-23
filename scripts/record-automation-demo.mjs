/**
 * Record a short demo of Thesis Screener automation on venlabs.io.
 * Output: artifacts/automation-demo.webm + .mp4
 *
 * Note: the app holds SSE open, so never wait for "networkidle" on /app routes.
 */
import { chromium } from "playwright";
import { mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const ROOT = "/home/josiaha/Repos/copyr";
const OUT_DIR = join(ROOT, "artifacts");
const VIDEO_DIR = join(OUT_DIR, "playwright-video");
mkdirSync(VIDEO_DIR, { recursive: true });

const BASE = process.env.DEMO_BASE_URL ?? "https://venlabs.io";
const PASSCODE = "hardtech";
const email = `demo+${randomBytes(4).toString("hex")}@example.com`;
const password = `Demo-${randomBytes(6).toString("hex")}!aA1`;
const companyName = `Helix Robotics ${Date.now().toString().slice(-6)}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gotoApp(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await sleep(1200);
}

async function main() {
  console.log("Recording against", BASE);
  console.log("Account", email, "company", companyName);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  try {
    // Landing → demo
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await sleep(1000);
    await page.getByRole("link", { name: /try the demo/i }).first().click();
    await page.waitForURL(/\/demo/, { timeout: 20_000 });
    await sleep(600);

    // Passcode
    await page.getByPlaceholder(/passcode/i).fill(PASSCODE);
    await page.getByRole("button", { name: /continue/i }).click();
    await page.waitForURL(/\/auth/, { timeout: 20_000 });
    await sleep(800);

    // Sign up
    await gotoApp(page, "/auth/sign-up");
    if (await page.getByPlaceholder(/passcode/i).count()) {
      await page.getByPlaceholder(/passcode/i).fill(PASSCODE);
      await page.getByRole("button", { name: /continue/i }).click();
      await sleep(600);
      await gotoApp(page, "/auth/sign-up");
    }
    await page.getByPlaceholder("Ada Lovelace").fill("Demo Partner");
    await page.getByPlaceholder("you@firm.vc").fill(email);
    await page.getByPlaceholder("Harbor Ventures").fill("Helix Ventures");
    const pw = page.locator('input[type="password"]');
    await pw.nth(0).fill(password);
    await pw.nth(1).fill(password);
    await page.getByRole("button", { name: /sign up with email/i }).click();
    await page.waitForURL(/\/app/, { timeout: 60_000 });
    await sleep(2000);

    // Automations → agents
    await gotoApp(page, "/app/automations");
    await page.getByText("Thesis Screener", { exact: true }).first().waitFor({ state: "visible" });
    await sleep(1500);

    // Workflows tab (label includes count)
    await page.getByRole("button", { name: /workflows/i }).click();
    await sleep(800);
    await page.getByText("Screen new companies").first().waitFor({ state: "visible", timeout: 20_000 });
    await sleep(2000);

    // Add company → triggers company.created → Thesis Screener
    await page.getByRole("button", { name: /add company/i }).click();
    await sleep(700);
    await page.getByRole("button", { name: /manual/i }).click();
    await sleep(400);
    await page.locator('input[name="companyName"]').fill(companyName);
    await page.locator('select[name="roundStage"]').selectOption("Series A");
    await page.locator('input[name="askAmount"]').fill("8");
    await page.locator('input[name="description"]').fill(
      "Autonomous warehouse robots. ARR $1.4M growing 220% YoY. Team of 19 in Seattle.",
    );
    await sleep(800);
    await page.getByRole("button", { name: /create deal/i }).click();
    // Wait for modal to close
    await page.locator('input[name="companyName"]').waitFor({ state: "hidden", timeout: 30_000 }).catch(() => undefined);
    await sleep(2500);

    // Runs tab — wait for completed agent run
    await gotoApp(page, "/app/automations");
    await page.getByRole("button", { name: /^runs$/i }).click();
    await sleep(1000);

    const deadline = Date.now() + 90_000;
    let seen = false;
    while (Date.now() < deadline) {
      const text = await page.locator("body").innerText();
      // Overview summaries look like "65/100 → WATCH · …" or agent status completed
      if (
        (/\d+\s*\/\s*100\s*→\s*(ADVANCE|WATCH|PASS)/i.test(text) ||
          /Thesis Screener[\s\S]{0,80}(advance|watch|pass)/i.test(text)) &&
        /Screen new companies/i.test(text)
      ) {
        seen = true;
        break;
      }
      await sleep(2500);
      await page.getByRole("button", { name: /^runs$/i }).click().catch(() => undefined);
    }
    console.log(seen ? "Saw completed run in UI" : "Timed out waiting for completed run UI");
    await sleep(3000);

    // Pipeline / company for screening note
    await gotoApp(page, "/app/pipeline");
    const company = page.getByText(companyName).first();
    if (await company.count()) {
      await company.click();
      await sleep(2000);
      const note = page.getByText(/Thesis Screener|fit\s*\d+|ADVANCE|advance|watch|pass/i).first();
      if (await note.count()) {
        await note.scrollIntoViewIfNeeded().catch(() => undefined);
        await sleep(2500);
      } else {
        await sleep(2000);
      }
    } else {
      console.warn("Company card not found on pipeline");
      await sleep(1500);
    }

    console.log("Demo flow finished");
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) {
      const rawPath = await video.path();
      const destWebm = join(OUT_DIR, "automation-demo.webm");
      copyFileSync(rawPath, destWebm);
      console.log("Wrote", destWebm);
      const destMp4 = join(OUT_DIR, "automation-demo.mp4");
      execSync(
        `ffmpeg -y -i ${JSON.stringify(destWebm)} -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${JSON.stringify(destMp4)}`,
        { stdio: "inherit" },
      );
      console.log("Wrote", destMp4);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
