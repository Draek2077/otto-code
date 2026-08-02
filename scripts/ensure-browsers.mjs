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

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";

const BROWSER = "chromium";

/**
 * One command string rather than a program plus an argument array.
 *
 * `npx` is a `.cmd` on Windows, which Node refuses to spawn without a shell,
 * and passing an argument array alongside `shell: true` is deprecated because
 * the arguments are concatenated unescaped. A fixed string sidesteps both;
 * nothing here is interpolated from user input.
 */
const INSTALL_COMMAND = `npx playwright install ${BROWSER}`;
const DRY_RUN_COMMAND = `${INSTALL_COMMAND} --dry-run`;

/** Generous for a ~180 MB download and unzip; anything past it is a hang. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/**
 * Whether a browser is really installed at `path`.
 *
 * **An existing directory is not proof.** Playwright creates the target
 * directory before it unpacks into it, so a run that is interrupted — or whose
 * detached download child is killed — leaves an *empty* directory behind. A
 * bare `existsSync` reads that as installed, the launch then fails with
 * "Executable doesn't exist", and no amount of re-running the installer fixes
 * it because the installer agrees the directory is there.
 */
function isInstalled(path) {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

/**
 * The directories the pinned Playwright expects, straight from Playwright
 * itself. Parsed rather than computed so a revision is never written down in
 * this repo: `--dry-run` reports them whether or not they exist.
 */
function expectedInstallPaths() {
  const output = execSync(DRY_RUN_COMMAND, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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

  const missing = expected.filter((path) => !isInstalled(path));
  if (expected.length > 0 && missing.length === 0) {
    return;
  }

  console.log(`[browsers] installing ${BROWSER} (${missing.length} missing)`);
  try {
    execSync(INSTALL_COMMAND, {
      stdio: "inherit",
      // A browser install is a download and an unzip measured in tens of
      // seconds. Past this it is wedged, not slow, and the failure everyone
      // actually hits is an interrupted run whose detached download child
      // survived and still holds the shared lock: every later attempt then
      // waits on that lock forever, looking exactly like a slow download.
      // Failing loudly here beats hanging a test run indefinitely.
      timeout: INSTALL_TIMEOUT_MS,
    });
  } catch {
    console.error(
      [
        "",
        `[browsers] could not install ${BROWSER}.`,
        "",
        "  An interrupted install leaves two things behind, and both make every",
        "  later attempt look like a slow download rather than a failure: the",
        "  shared lock, and an empty browser directory. Killing the installer does",
        "  not kill its detached download child, so check for that first.",
        "",
        "    # Windows",
        "    Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
        "      Where-Object { $_.CommandLine -like '*playwright*' } |",
        "      ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
        String.raw`    Remove-Item -Recurse -Force "$env:LOCALAPPDATA\ms-playwright\__dirlock"`,
        "",
        "    # Linux / macOS",
        "    pkill -f oopDownloadBrowserMain",
        "    rm -rf ~/.cache/ms-playwright/__dirlock          # Linux",
        "    rm -rf ~/Library/Caches/ms-playwright/__dirlock  # macOS",
        "",
        "  Then delete any browser directory that is empty and re-run.",
        "",
        "  See docs/testing.md, One browser, and which one.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

main();
