import { defineConfig, devices } from "@playwright/test";

// Demo capture config: reuses the e2e global-setup stack (isolated daemon +
// temp OTTO_HOME + Metro web on dynamic ports) but records every run — video
// always on at the capture viewport, no retries (a bad take should fail
// loudly, not silently re-record), generous timeout for real provider runs.
const baseURL =
  process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_METRO_PORT ?? "8081"}`;

const CAPTURE_VIEWPORT = { width: 1440, height: 900 };
// Phone viewport at 3× — portrait PNGs come out 1080×1920, exactly the 9:16
// aspect the Play Console requires (each side 320–3840px).
const MOBILE_VIEWPORT = { width: 360, height: 640 };
// Tablet landscape at 2× — 2560×1440, exactly 16:9 for Play tablet listings.
// (The desktop capture viewport is 16:10, which the Play Console rejects.)
const TABLET_VIEWPORT = { width: 1280, height: 720 };
// iPhone 6.7" at 3× — 1290×2796, the App Store's required portrait size.
const IOS_VIEWPORT = { width: 430, height: 932 };

export default defineConfig({
  testDir: "./demo/scenarios",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 600_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "demo",
      testMatch: ["**/*.demo.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: CAPTURE_VIEWPORT,
        video: { mode: "on", size: CAPTURE_VIEWPORT },
      },
    },
    // Feature spreads are stills-only sweeps — no video, faster runs.
    {
      name: "spread",
      testMatch: ["**/*.spread.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: CAPTURE_VIEWPORT,
        video: "off",
      },
    },
    {
      name: "spread-mobile",
      testMatch: ["**/*.spread.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: MOBILE_VIEWPORT,
        deviceScaleFactor: 3,
        video: "off",
      },
    },
    {
      name: "spread-tablet",
      testMatch: ["**/*.spread.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: TABLET_VIEWPORT,
        deviceScaleFactor: 2,
        video: "off",
      },
    },
    {
      name: "spread-ios",
      testMatch: ["**/*.spread.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: IOS_VIEWPORT,
        deviceScaleFactor: 3,
        video: "off",
      },
    },
  ],
});
