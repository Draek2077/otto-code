import { defineConfig, devices } from "@playwright/test";

// E2E_METRO_PORT is set dynamically by global-setup.ts after finding a free port
// This allows multiple test runs in parallel across different worktrees
const baseURL =
  process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_METRO_PORT ?? "8081"}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // E2E tests share a single daemon/relay/metro stack from global setup.
  // Running tests concurrently causes cross-test contention and non-deterministic failures.
  fullyParallel: false,
  workers: 1,
  // Two retries in CI: the shared metro/daemon/relay stack occasionally drops a
  // browser at startup ("Target page/context or browser has been closed"), which
  // is pure environmental flake a retry clears. Deterministic failures still fail
  // every attempt, so this doesn't mask real regressions.
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.E2E_RECORD_VIDEO === "1" ? "on" : "retain-on-failure",
  },
  projects: [
    {
      name: "Desktop Chrome",
      testIgnore: ["**/*.real.spec.ts"],
      // E2E_BROWSER_CHANNEL lets local runs drive an installed browser (e.g.
      // "msedge" on Windows) instead of Playwright's downloaded chromium.
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL },
    },
    {
      name: "real-provider",
      testMatch: ["**/*.real.spec.ts"],
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL },
    },
  ],
  // Note: Metro is started by global-setup.ts on a dynamic port to allow parallel test runs
});
