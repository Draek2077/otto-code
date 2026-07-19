import { defineConfig, devices } from "@playwright/test";
import {
  DESKTOP_CAPTURE_RESOLUTION,
  DESKTOP_CAPTURE_SCALE,
  DESKTOP_LAYOUT_VIEWPORT,
} from "./demo/helpers/resolution";

// Demo capture config: reuses the e2e global-setup stack (isolated daemon +
// temp OTTO_HOME + Metro web on dynamic ports) but records every run — video
// always on at the capture viewport, no retries (a bad take should fail
// loudly, not silently re-record), generous timeout for real provider runs.
const baseURL =
  process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_METRO_PORT ?? "8081"}`;

// Desktop lanes lay out at DESKTOP_LAYOUT_VIEWPORT (1024×576 logical at the
// current 2.5× scale) and capture at DESKTOP_CAPTURE_SCALE device pixels, so
// the app renders at a comfortable size while the PNGs/video still come out at
// full 16:9 QHD (2560×1440). Setting the viewport straight to the QHD output
// would make the app lay out as if on a giant screen — every control tiny. The
// zoom knob and its ceiling live in demo/helpers/resolution.ts.
const CAPTURE_VIEWPORT = DESKTOP_LAYOUT_VIEWPORT;
const CAPTURE_SCALE = DESKTOP_CAPTURE_SCALE;
const CAPTURE_VIDEO_SIZE = DESKTOP_CAPTURE_RESOLUTION;
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
    // Every step-by-step demo captures both site-default themes — scenarios
    // read their theme from the project name (see demo/helpers/theme.ts) and
    // suffix their own .out dir, so this needs no other config plumbing.
    {
      name: "demo-twilight",
      testMatch: ["**/*.demo.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: CAPTURE_VIEWPORT,
        deviceScaleFactor: CAPTURE_SCALE,
        video: { mode: "on", size: CAPTURE_VIDEO_SIZE },
      },
    },
    {
      name: "demo-daylight",
      testMatch: ["**/*.demo.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: CAPTURE_VIEWPORT,
        deviceScaleFactor: CAPTURE_SCALE,
        video: { mode: "on", size: CAPTURE_VIDEO_SIZE },
      },
    },
    // Feature spreads are stills-only sweeps — no video, faster runs. Desktop
    // spreads (the website's feature sections) get both themes too;
    // mobile/tablet/ios keep their store-listing-convention themes untouched.
    {
      name: "spread-twilight",
      testMatch: ["**/*.spread.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: CAPTURE_VIEWPORT,
        deviceScaleFactor: CAPTURE_SCALE,
        video: "off",
      },
    },
    {
      name: "spread-daylight",
      testMatch: ["**/*.spread.ts"],
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL,
        viewport: CAPTURE_VIEWPORT,
        deviceScaleFactor: CAPTURE_SCALE,
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
