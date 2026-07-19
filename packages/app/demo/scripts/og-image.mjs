#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

// Renders demo/assets/og-image.html to the website's og:image / twitter:image
// (exactly 1200×630 PNG, the standard Open Graph card size). No daemon
// needed — this is a static page render, same pattern as feature-graphic.mjs.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(scriptDir, "../assets/og-image.html");
const outPath = path.resolve(scriptDir, "../../../website/public/og-image.png");

async function launch() {
  const channel = process.env.E2E_BROWSER_CHANNEL;
  try {
    return await chromium.launch(channel ? { channel } : {});
  } catch {
    // Fall back to the system Edge when Playwright's chromium isn't installed.
    return chromium.launch({ channel: "msedge" });
  }
}

const browser = await launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(pathToFileURL(templatePath).href);
  await page.waitForTimeout(300);
  await page.screenshot({ path: outPath });
  await page.close();
  console.log(`[demo] og-image.png (1200x630) → ${outPath}`);
} finally {
  await browser.close();
}
