// Must be set before `defineConfig` below is evaluated and, critically,
// before Playwright imports `./e2e/global-setup.ts` — that shared file reads
// this flag when spawning Metro to add OTTO_WEB_PLATFORM=electron +
// EXPO_PUBLIC_LOCAL_DAEMON to the child env, which is what makes Metro bundle
// `.electron.tsx` files (browser-pane.electron.tsx, the real <webview>
// component) instead of the plain `.web.tsx` fallback. This is the exact same
// toggle packages/app/e2e/project-picker-desktop.spec.ts uses via
// `cross-env E2E_DESKTOP_RUNTIME=1` on the command line; setting it here
// instead keeps this a self-contained lane with one npm script.
process.env.E2E_DESKTOP_RUNTIME = "1";

import { defineConfig } from "@playwright/test";

// Electron demo capture lane: reuses the same e2e global-setup stack as
// playwright.demo.config.ts (isolated daemon + temp OTTO_HOME + Metro web on
// dynamic ports), but drives a real Electron desktop app window instead of a
// Playwright-launched browser. There is deliberately no `use: { ...devices }`
// browser config here — test files in this lane don't touch the implicit
// `page` fixture at all; they call `launchDesktopElectron()`
// (e2e/helpers/electron-app.ts) directly and manage their own Page sourced
// from `electronApp.firstWindow()`.
//
// This is purely additive: playwright.demo.config.ts, its demo-twilight /
// demo-daylight / spread-* projects, and e2e/global-setup.ts's default
// (E2E_DESKTOP_RUNTIME unset) behavior are all untouched by this file.
export default defineConfig({
  testDir: "./demo/scenarios",
  testMatch: ["**/*.electron.ts"],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 600_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
