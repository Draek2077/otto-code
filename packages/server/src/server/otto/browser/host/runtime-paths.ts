import path from "node:path";
import os from "node:os";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { chromium } from "playwright-core";
import { createBrowserToolsRequestError } from "../../../browser-tools/errors.js";

export function hostBrowserCandidates(input: {
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  home: string;
  bundled: string;
}): string[] {
  const { environment: env, platform, home, bundled } = input;
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(
      (value): value is string => Boolean(value),
    );
    return [
      ...new Set([
        ...roots.map((root) =>
          path.win32.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        ),
        ...roots.map((root) =>
          path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        ),
        bundled,
      ]),
    ];
  }
  if (platform === "darwin")
    return [
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.posix.join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      bundled,
    ];
  return [
    // Prefer the native Chromium/Chrome distributions on Linux. Edge's
    // current Linux build can enter an XCB/Vulkan startup path without a display,
    // even with the documented headless/SwANGLE selectors (CI native trace).
    // Selection is still read-only and never retries another brand after launch.
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    bundled,
    "/usr/bin/microsoft-edge",
  ];
}
/** Read-only discovery. No shell, automatic download, profile repair or global installation. */
export async function resolveHostBrowser(): Promise<string> {
  const candidates = hostBrowserCandidates({
    platform: process.platform,
    environment: process.env,
    home: os.homedir(),
    bundled: chromium.executablePath(),
  });
  for (const candidate of candidates) {
    if (!(process.platform === "win32" ? path.win32 : path.posix).isAbsolute(candidate)) continue;
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      if (!(await stat(candidate)).isFile()) continue;
      return candidate;
    } catch {
      /* The next known installation may be available. */
    }
  }
  throw createBrowserToolsRequestError({
    code: "browser_no_host",
    message:
      "No supported host browser is installed. Install Microsoft Edge, Google Chrome or the repository's Chromium runtime on this host, then explicitly reopen Host Browser.",
  });
}
