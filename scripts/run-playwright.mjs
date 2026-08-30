#!/usr/bin/env node
/**
 * Run the repository-pinned Playwright CLI against Otto's checkout-local
 * browser cache. The global Playwright cache is shared by every checkout and
 * application on a developer machine, so it is not a safe test dependency.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserCache = path.join(repositoryRoot, ".tmp", "otto-playwright-browsers");
const require = createRequire(import.meta.url);
const playwrightCli = path.join(path.dirname(require.resolve("playwright/package.json")), "cli.js");

const child = spawn(process.execPath, [playwrightCli, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || browserCache,
  },
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`[playwright] failed to start: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
