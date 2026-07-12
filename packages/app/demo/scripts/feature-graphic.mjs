#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

// Renders demo/assets/feature-graphic.html to the Play Store feature graphic
// (exactly 1024×500 PNG) plus a 2× variant for the website. No daemon needed —
// this is a static page render.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(scriptDir, "../assets/feature-graphic.html");
const outDir = path.resolve(scriptDir, "../../../website/public/demos/brand");

async function launch() {
  const channel = process.env.E2E_BROWSER_CHANNEL;
  try {
    return await chromium.launch(channel ? { channel } : {});
  } catch {
    // Fall back to the system Edge when Playwright's chromium isn't installed.
    return chromium.launch({ channel: "msedge" });
  }
}

async function render(browser, { scale, fileName }) {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 500 },
    deviceScaleFactor: scale,
  });
  await page.goto(pathToFileURL(templatePath).href);
  await page.waitForTimeout(300);
  const outPath = path.join(outDir, fileName);
  await page.screenshot({ path: outPath });
  await page.close();
  console.log(`[demo] ${fileName} (${1024 * scale}x${500 * scale}) → ${outPath}`);
}

await mkdir(outDir, { recursive: true });
const browser = await launch();
try {
  await render(browser, { scale: 1, fileName: "feature-graphic.png" });
  await render(browser, { scale: 2, fileName: "feature-graphic@2x.png" });
} finally {
  await browser.close();
}
