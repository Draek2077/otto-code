import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
// `electron`'s package.json `main` is a CJS module whose default export is
// the path string to the platform binary — the same value
// packages/desktop/scripts/dev-runner.mjs gets from `require("electron")`.
import electronPath from "electron";
import { buildCreateAgentPreferences, buildSeededHost } from "./daemon-registry";
import { resizePngToTarget, type ImageSize } from "./image";

const EXTRA_HOSTS_KEY = "@otto:e2e-extra-hosts";

export interface LaunchDesktopElectronInput {
  /** Metro dev server port — must have been started with OTTO_WEB_PLATFORM=electron. */
  metroPort: number;
  /** Isolated E2E daemon port to seed as the only registered host. */
  daemonPort: number;
  /** Isolated E2E daemon's server id, as returned by its pairing offer. */
  serverId: string;
  /**
   * Sets the real BrowserWindow's content area to this logical size right
   * after launch (via BrowserWindow.setContentSize in the main process — not
   * Playwright's setViewportSize, which for Electron only overrides what the
   * page's JS reports and never touches the actual OS window desktopCapturer
   * sees). Omit to use whatever size a fresh, unpersisted window state
   * defaults to (see window-manager.ts's DEFAULT_WINDOW_WIDTH/HEIGHT).
   */
  windowSize?: ImageSize;
}

export interface LaunchedDesktopElectron {
  app: ElectronApplication;
  /** The main window's Page — a real Playwright Page, same API as a browser page. */
  window: Page;
  /** Scratch userData dir created for this launch; removed by close(). */
  userDataDir: string;
  close(): Promise<void>;
}

export interface CaptureWindowWithChromeResult {
  /** Pixel width of the captured thumbnail (physical pixels, post-DPI-scale). */
  width: number;
  /** Pixel height of the captured thumbnail (physical pixels, post-DPI-scale). */
  height: number;
}

/**
 * Captures the app's main window exactly as composited on screen — including
 * OS-drawn window chrome (Windows Window Controls Overlay minimize/maximize/
 * close buttons, or whatever the platform actually paints there) — and writes
 * it to `outputPath` as a PNG.
 *
 * Standard Playwright `page.screenshot()` (CDP's `Page.captureScreenshot`)
 * only rasterizes the web content surface; it can never show WCO buttons
 * because those are painted by Electron/Chromium's native window-chrome
 * compositor layer, not the DOM. This instead uses Electron's `desktopCapturer`
 * — real screen/window capture (DXGI/GDI-backed on Windows) — which sees the
 * window's true visible surface. `desktopCapturer` only exists in Electron's
 * main process (not the renderer, as of Electron 21+), so the capture runs
 * inside `electronApp.evaluate()`.
 */
export async function captureWindowWithChrome(
  electronApp: ElectronApplication,
  outputPath: string,
  targetSize?: ImageSize,
): Promise<CaptureWindowWithChromeResult> {
  const captured = await electronApp.evaluate(async ({ desktopCapturer, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible());
    if (!win) {
      throw new Error(
        "captureWindowWithChrome: no visible BrowserWindow found (desktopCapturer can only " +
          "capture windows that are actually composited on screen).",
      );
    }

    const title = win.getTitle();
    const bounds = win.getBounds();
    // getSources() downscales its thumbnail to fit within thumbnailSize while
    // preserving aspect ratio, so this must be at least as large as the
    // window's real pixel size — pad generously to cover HiDPI scale factors
    // the main process doesn't need to compute exactly here.
    const thumbnailSize = {
      width: Math.max(bounds.width * 3, 1920),
      height: Math.max(bounds.height * 3, 1080),
    };

    const sources = await desktopCapturer.getSources({ types: ["window"], thumbnailSize });
    // Prefer an exact title match (robust against other windows on the CI/dev
    // machine's desktop); fall back to the first non-empty-named source since
    // some platforms report window titles inconsistently.
    const source =
      sources.find((candidate) => candidate.name === title) ??
      sources.find((candidate) => candidate.name.length > 0);
    if (!source) {
      throw new Error(
        `captureWindowWithChrome: desktopCapturer returned no usable window source ` +
          `(looked for title "${title}"); available names: ${sources.map((s) => s.name).join(", ") || "(none)"}`,
      );
    }

    const size = source.thumbnail.getSize();
    return {
      base64Png: source.thumbnail.toPNG().toString("base64"),
      width: size.width,
      height: size.height,
    };
  });

  await writeFile(outputPath, Buffer.from(captured.base64Png, "base64"));
  if (targetSize) {
    const resized = await resizePngToTarget(outputPath, targetSize);
    return resized;
  }
  return { width: captured.width, height: captured.height };
}

function buildSeededDesktopSettingsDocument(): string {
  // manageBuiltInDaemon: false is the load-bearing bit — it keeps
  // shouldStartBuiltInDaemon() (packages/app/src/app/_layout.tsx) from ever
  // calling start_desktop_daemon at boot, so this Electron instance never
  // tries to spawn its own daemon alongside the isolated e2e one.
  return `${JSON.stringify(
    {
      version: 1,
      settings: {
        releaseChannel: "stable",
        daemon: { manageBuiltInDaemon: false, keepRunningAfterQuit: true },
        tray: { minimizeOnClose: true, startMinimized: false },
        quit: { warnBeforeQuit: false, onlyWarnForActiveAgents: false },
      },
      migrations: { legacyRendererSettingsImported: true },
    },
    null,
    2,
  )}\n`;
}

/**
 * Launches the real packaged-shape Electron desktop app (packages/desktop's
 * built dist/main.js) against an already-running Metro dev server (built with
 * OTTO_WEB_PLATFORM=electron so browser-pane.electron.tsx — the real
 * <webview>-backed component — is what actually ships in the bundle) and an
 * already-running isolated e2e daemon. Callers must build packages/desktop's
 * main process first (`npm run build:main --workspace=@otto-code/desktop`);
 * this function only fails fast with a clear error if that wasn't done.
 */
export async function launchDesktopElectron(
  input: LaunchDesktopElectronInput,
): Promise<LaunchedDesktopElectron> {
  const desktopDir = path.resolve(__dirname, "../../../desktop");
  const mainEntry = path.join(desktopDir, "dist", "main.js");
  if (!existsSync(mainEntry)) {
    throw new Error(
      `Electron main entry not built: ${mainEntry}\n` +
        `Run "npm run build:main --workspace=@otto-code/desktop" before launching this lane.`,
    );
  }

  const userDataDir = await mkdtemp(path.join(tmpdir(), "otto-e2e-electron-userdata-"));
  await writeFile(
    path.join(userDataDir, "desktop-settings.json"),
    buildSeededDesktopSettingsDocument(),
    "utf8",
  );

  const devServerUrl = `http://localhost:${input.metroPort}`;

  const app = await electron.launch({
    args: [desktopDir],
    cwd: desktopDir,
    executablePath: electronPath as unknown as string,
    env: {
      ...process.env,
      EXPO_DEV_URL: devServerUrl,
      OTTO_ELECTRON_USER_DATA_DIR: userDataDir,
      // Otherwise a second launch racing an already-running dev/prod Electron
      // instance on this machine could silently hand off to it instead of
      // creating its own window.
      OTTO_DISABLE_SINGLE_INSTANCE_LOCK: "1",
      OTTO_TEST_APP_NAME: `OttoE2EElectron-${Date.now()}`,
    },
  });

  const window = await app.firstWindow();

  if (input.windowSize) {
    // setContentSize (not setSize/setBounds) targets the renderable content
    // area specifically — this app's frameless/WCO chrome config (see
    // window-manager.ts's getMainWindowChromeOptions) draws its title-bar
    // overlay INSIDE that content area rather than adding to it, so content
    // size is what determines what actually renders on screen here. Applied
    // before the first navigation settles so there's no post-load reflow.
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        win.setContentSize(size.width, size.height, false);
      }
    }, input.windowSize);
  }

  // The main process already kicked off its own loadURL(DEV_SERVER_URL) before
  // firstWindow() resolved here (main.ts calls it unconditionally in dev).
  // Let that first navigation finish — it may be Metro's first request for
  // the bundle (cold compile of the whole module graph), which can
  // comfortably exceed Playwright's 30s default action timeout.
  await window.waitForLoadState("load", { timeout: 120_000 });

  const nowIso = new Date().toISOString();
  const seedNonce = Math.random().toString(36).slice(2);
  const seededHost = buildSeededHost({
    serverId: input.serverId,
    endpoint: `127.0.0.1:${input.daemonPort}`,
    nowIso,
  });
  const createAgentPreferences = buildCreateAgentPreferences(seededHost.serverId);

  // Mirrors fixtures.ts's ottoE2ESetup seeding. addInitScript applies to every
  // subsequent navigation — the reload() below is what actually makes it take
  // effect, since the first navigation (awaited above) already ran unseeded.
  await window.addInitScript(
    (seedInput: {
      daemon: ReturnType<typeof buildSeededHost>;
      preferences: ReturnType<typeof buildCreateAgentPreferences>;
      seedNonce: string;
      extraHostsKey: string;
    }) => {
      localStorage.setItem("@otto:e2e", "1");
      localStorage.setItem("@otto:e2e-seed-nonce", seedInput.seedNonce);

      const rawExtraHosts = localStorage.getItem(seedInput.extraHostsKey);
      const extraHosts = rawExtraHosts ? JSON.parse(rawExtraHosts) : [];

      localStorage.setItem(
        "@otto:daemon-registry",
        JSON.stringify([seedInput.daemon, ...extraHosts]),
      );
      localStorage.removeItem("@otto:settings");
      localStorage.setItem("@otto:create-agent-preferences", JSON.stringify(seedInput.preferences));
    },
    {
      daemon: seededHost,
      preferences: createAgentPreferences,
      seedNonce,
      extraHostsKey: EXTRA_HOSTS_KEY,
    },
  );

  // reload(), not goto(devServerUrl): navigating to the exact URL the page is
  // already on can be a same-document no-op in Chromium/Electron, and
  // Playwright's goto() then hangs waiting for a lifecycle event that never
  // fires. reload() unambiguously starts a fresh navigation. Metro has
  // already cached the module graph from the first load above, so this is
  // fast regardless of the first load's cold-compile time.
  await window.reload({ timeout: 120_000 });

  return {
    app,
    window,
    userDataDir,
    close: async () => {
      await app.close().catch(() => undefined);
      await rm(userDataDir, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      }).catch(() => undefined);
    },
  };
}
