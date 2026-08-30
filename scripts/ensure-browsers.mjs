#!/usr/bin/env node
/**
 * Install the browser revision pinned by this checkout's Playwright dependency.
 *
 * Browser downloads live in Otto's checkout-local cache. The Playwright CLI's
 * out-of-process downloader has repeatedly received a complete archive and
 * then hung before releasing its lock, so this script owns the bounded download
 * and extraction instead of treating that global implementation detail as test
 * infrastructure.
 */

import { execFileSync, execSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const BROWSER = "chromium";
const INSTALL_TIMEOUT_MS = 5 * 60_000;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const browserCache =
  process.env.PLAYWRIGHT_BROWSERS_PATH ||
  path.join(repositoryRoot, ".tmp", "otto-playwright-browsers");
const installLock = path.join(browserCache, ".otto-install-lock");
const installLockOwner = path.join(installLock, "owner.json");
const INSTALL_COMMAND = `npx playwright install ${BROWSER}`;
const DRY_RUN_COMMAND = `${INSTALL_COMMAND} --dry-run`;

function isWithinBrowserCache(installPath) {
  const relative = path.relative(browserCache, installPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function isInstalled(installPath) {
  try {
    await readFile(path.join(installPath, "INSTALLATION_COMPLETE"));
    return true;
  } catch {
    return false;
  }
}

function expectedInstalls() {
  const output = execSync(DRY_RUN_COMMAND, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache },
  });
  const installs = new Map();
  let installPath = null;
  for (const line of output.split("\n")) {
    const installMatch = /^\s*Install location:\s*(.+?)\s*$/.exec(line);
    if (installMatch) {
      installPath = installMatch[1];
      continue;
    }
    const urlMatch = /^\s*Download url:\s*(.+?)\s*$/.exec(line);
    if (installPath && urlMatch && isWithinBrowserCache(installPath)) {
      installs.set(installPath, urlMatch[1]);
      installPath = null;
    }
  }
  return [...installs].map(([pathToInstall, url]) => ({ installPath: pathToInstall, url }));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function lockOwnerIsAlive() {
  try {
    const owner = JSON.parse(await readFile(installLockOwner, "utf8"));
    return typeof owner.pid === "number" && processExists(owner.pid);
  } catch {
    return false;
  }
}

async function acquireInstallLock() {
  await mkdir(browserCache, { recursive: true });
  const deadline = Date.now() + INSTALL_TIMEOUT_MS;
  while (true) {
    try {
      await mkdir(installLock);
      await writeFile(
        installLockOwner,
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
      );
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    if (!(await lockOwnerIsAlive())) {
      await rm(installLock, { recursive: true, force: true, maxRetries: 3 });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for Otto's Playwright installer lock at ${installLock}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function downloadArchive(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS) });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status} ${response.statusText}) for ${url}`);
  }
  const expectedBytes = Number(response.headers.get("content-length"));
  const output = createWriteStream(destination, { flags: "wx" });
  let receivedBytes = 0;
  try {
    for await (const chunk of response.body) {
      receivedBytes += chunk.length;
      if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
      // Some CDN connections keep the response open after exactly the declared
      // archive length. The archive is complete at that point; stop waiting for
      // a connection close that may never arrive.
      if (Number.isFinite(expectedBytes) && receivedBytes >= expectedBytes) break;
    }
    output.end();
    await finished(output);
  } catch (error) {
    output.destroy();
    throw error;
  } finally {
    await response.body.cancel().catch(() => undefined);
  }
  if (Number.isFinite(expectedBytes) && receivedBytes !== expectedBytes) {
    throw new Error(`Downloaded ${receivedBytes} bytes, expected ${expectedBytes}, from ${url}`);
  }
}

function extractArchive(archive, destination) {
  if (process.platform === "win32") {
    // Windows' bsdtar reads a drive-letter path as its legacy remote-archive
    // syntax (`C:`), so use the native ZIP extractor instead.
    const literal = (value) => `'${value.replaceAll("'", "''")}'`;
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(destination)} -Force`,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  execFileSync("unzip", ["-q", archive, "-d", destination], { stdio: "inherit" });
}

async function installOne({ installPath, url }) {
  const parent = path.dirname(installPath);
  const archive = path.join(
    tmpdir(),
    `otto-playwright-${path.basename(installPath)}-${process.pid}.zip`,
  );
  const partial = `${installPath}.partial-${process.pid}`;
  await rm(archive, { force: true });
  await rm(partial, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(parent, { recursive: true });
  try {
    console.log(`[browsers] downloading ${path.basename(installPath)}`);
    await downloadArchive(url, archive);
    await mkdir(partial, { recursive: true });
    extractArchive(archive, partial);
    await writeFile(path.join(partial, "INSTALLATION_COMPLETE"), "");
    await rm(installPath, { recursive: true, force: true, maxRetries: 3 });
    await rename(partial, installPath);
  } finally {
    await rm(archive, { force: true }).catch(() => undefined);
    await rm(partial, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
}

async function main() {
  const expected = expectedInstalls();
  if (expected.length === 0)
    throw new Error("Playwright did not report any Chromium install locations.");
  if (
    (await Promise.all(expected.map(({ installPath }) => isInstalled(installPath)))).every(Boolean)
  )
    return;

  let acquired = false;
  try {
    await acquireInstallLock();
    acquired = true;
    const missing = [];
    for (const install of expectedInstalls()) {
      if (!(await isInstalled(install.installPath))) missing.push(install);
    }
    for (const install of missing) await installOne(install);
  } finally {
    if (acquired) await rm(installLock, { recursive: true, force: true, maxRetries: 3 });
  }
}

try {
  await main();
} catch (error) {
  console.error(`[browsers] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
