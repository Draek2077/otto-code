#!/usr/bin/env node
/**
 * Make sure the Playwright browser this repo pins is on disk, and install it if
 * it is not.
 *
 * Runs as a `pre` hook for `test:browser` and `test:e2e`. The rule it enforces
 * is in docs/testing.md: one browser for every automated test on every
 * platform, pinned by the `playwright` version in package.json and by nothing
 * else.
 *
 * The check is deliberately not "just run `playwright install`". That command
 * takes a global lock under the shared user-level browser cache, so on the
 * common path — the browser is already there — an unconditional install turns a
 * lock left behind by an interrupted run in *another* checkout into a hard
 * failure of this one. So: ask Playwright where the browsers it wants should
 * live, look, and only shell out when something is actually missing.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const BROWSER = "chromium";

/**
 * The directories the pinned Playwright expects, straight from Playwright
 * itself. Parsed rather than computed so a revision is never written down in
 * this repo: `--dry-run` reports them whether or not they exist.
 */
function expectedInstallPaths() {
  const output = execFileSync("npx", ["playwright", "install", "--dry-run", BROWSER], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const paths = new Set();
  for (const line of output.split("\n")) {
    const match = /^\s*Install location:\s*(.+?)\s*$/.exec(line);
    if (match) {
      paths.add(match[1]);
    }
  }
  return [...paths];
}

function main() {
  let expected;
  try {
    expected = expectedInstallPaths();
  } catch (error) {
    // Playwright itself is unusable. Say so plainly and let the test run
    // produce its own error rather than guessing at a fix.
    console.warn(`[browsers] could not ask Playwright what it needs: ${error.message}`);
    return;
  }

  const missing = expected.filter((path) => !existsSync(path));
  if (expected.length > 0 && missing.length === 0) {
    return;
  }

  console.log(`[browsers] installing ${BROWSER} (${missing.length} missing)`);
  try {
    execFileSync("npx", ["playwright", "install", BROWSER], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } catch {
    console.error(
      [
        "",
        `[browsers] could not install ${BROWSER}.`,
        "",
        "  If the error above mentions an active lockfile, another checkout was",
        "  interrupted mid-install and left it behind. The browser cache is shared",
        "  across every project on this machine. Remove the lock and re-run:",
        "",
        "    rm -rf ~/AppData/Local/ms-playwright/__dirlock   # Windows",
        "    rm -rf ~/.cache/ms-playwright/__dirlock          # Linux",
        "    rm -rf ~/Library/Caches/ms-playwright/__dirlock  # macOS",
        "",
        "  See docs/testing.md, One browser, and which one.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

main();
