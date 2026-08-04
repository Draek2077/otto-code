import { defineConfig, devices } from "@playwright/test";

// E2E_METRO_PORT is set dynamically by global-setup.ts after finding a free port
// This allows multiple test runs in parallel across different worktrees
const baseURL =
  process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_METRO_PORT ?? "8081"}`;

// Artifacts (traces, videos, screenshots) live under a per-project directory.
// Playwright wipes a test's output directory - and its worker's shared
// `.playwright-artifacts-N` scratch dir - as the test starts, so two Playwright
// runs sharing one output root delete each other's in-flight artifacts. That's
// how a failing spec ends up reporting `ENOENT ... trace.zip` instead of its
// real assertion error. This repo routinely has more than one agent running
// specs in the same checkout (a T1 batch and the T2 local-AI batch at once), so
// isolate by project, and let E2E_OUTPUT_DIR separate two runs of the same
// project (e.g. two agents both running `Desktop Chrome`).
const outputRoot = process.env.E2E_OUTPUT_DIR ?? "test-results";

function projectOutputDir(projectName: string): string {
  return `${outputRoot}/${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

// Reporters are global (not per-project), so the tier scripts set these to keep
// a T2/T3 run from wiping the T1 run's report while it's still being written.
const htmlReportDir = process.env.E2E_HTML_REPORT_DIR ?? "playwright-report";
const qaReportDir = process.env.E2E_REPORT_DIR ?? "e2e-report";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  // Set by CI (see `E2E_GLOBAL_TIMEOUT_MINUTES` in ci.yml) and deliberately unset
  // locally, where a run is interactive and interruptible. It exists so a shard
  // that overruns still produces a report: Playwright stops itself and prints
  // what it has, instead of being SIGKILLed by the runner's job cap with nothing
  // to show. Note this is a whole-run budget, so it can fire mid-test.
  globalTimeout: process.env.E2E_GLOBAL_TIMEOUT_MINUTES
    ? Number(process.env.E2E_GLOBAL_TIMEOUT_MINUTES) * 60_000
    : undefined,
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
  // `list` for the terminal, `html` for the native trace/log viewer, and the QA
  // reporter for the release-check artifacts (per-module TOC, per-test evidence,
  // money-shot digest, failure report). See projects/e2e-qa-coverage/reporting.md.
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: htmlReportDir }],
    ["./e2e/reporters/qa-reporter.ts", { outputDir: qaReportDir }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: process.env.E2E_RECORD_VIDEO === "1" ? "on" : "retain-on-failure",
  },
  projects: [
    {
      name: "Desktop Chrome",
      outputDir: projectOutputDir("Desktop Chrome"),
      testIgnore: ["**/*.real.spec.ts", "**/*.local.spec.ts"],
      // E2E_BROWSER_CHANNEL lets local runs drive an installed browser (e.g.
      // "msedge" on Windows) instead of Playwright's downloaded chromium.
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL },
    },
    {
      name: "real-provider",
      outputDir: projectOutputDir("real-provider"),
      testMatch: ["**/*.real.spec.ts"],
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL },
    },
    {
      // Live agent-loop specs against the local LM Studio model (free inference).
      // Local inference is slow and nondeterministic: generous timeout, one retry.
      name: "local-ai",
      outputDir: projectOutputDir("local-ai"),
      testMatch: ["**/*.local.spec.ts"],
      timeout: 240_000,
      retries: 1,
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL },
    },
  ],
  // Note: Metro is started by global-setup.ts on a dynamic port to allow parallel test runs
});
