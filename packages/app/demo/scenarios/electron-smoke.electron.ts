import net from "node:net";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { captureWindowWithChrome, launchDesktopElectron } from "../../e2e/helpers/electron-app";
import { connectDaemonClient } from "../../e2e/helpers/daemon-client-loader";
import { resizePngToTarget } from "../../e2e/helpers/image";
import type { SeedDaemonClient } from "../../e2e/helpers/seed-client";
import { createTempGitRepo } from "../../e2e/helpers/workspace";
import { getE2EDaemonPort } from "../../e2e/helpers/daemon-port";
import { buildHostAgentDetailRoute } from "../../src/utils/host-routes";
import { DESKTOP_CAPTURE_RESOLUTION, DESKTOP_LAYOUT_VIEWPORT } from "../helpers/resolution";

/**
 * Electron capture-lane smoke test — proves the whole new lane end to end:
 * a real Electron desktop window (not plain Chromium) rendering Otto's
 * `<webview>`-backed Preview browser pane with genuine dev-server content
 * inside it. This is the scenario that unblocks
 * projects/site-demos "02-preview-verify": Preview's `<webview>` tag only has
 * runtime behavior inside Electron's renderer, so the plain-Chromium demo
 * pipeline (playwright.demo.config.ts) can never capture it — see
 * docs/preview.md and this file's sibling playwright.demo-electron.config.ts.
 */

interface PreviewCapableClient extends SeedDaemonClient {
  previewListConfig(cwd: string): Promise<{
    configured: boolean;
    servers: Array<{ name: string; port: number }>;
    runningServers?: Array<{
      serverId: string;
      name: string;
      port: number;
      status: string;
    }>;
  }>;
  previewStop(serverId: string): Promise<{ success: boolean; error?: string | null }>;
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

// Self-contained: Playwright serializes only this function's own source text
// to run inside the Electron window, so it must not reference any
// Node-scoped helper (it wouldn't exist in the browser).
function hasNavigatedWebview(): boolean {
  const webviews = Array.from(document.querySelectorAll("webview"));
  for (const webview of webviews) {
    const src = webview.getAttribute("src") ?? "";
    if (src.length > 0 && !src.startsWith("about:")) {
      return true;
    }
  }
  return false;
}

function buildStaticServerScript(port: number): string {
  // A minimal CommonJS static server — no external deps, so the preview's
  // launch.json can spawn it with a bare `node` runtimeExecutable regardless
  // of what else is on PATH in the isolated e2e environment.
  return [
    'const http = require("node:http");',
    `const PORT = ${port};`,
    'const HTML = "<!doctype html><html><body><h1 id=\\"otto-e2e-preview-marker\\" style=\\"font-family: sans-serif; color: #1a7f37;\\">Otto Electron preview smoke OK</h1></body></html>";',
    "http",
    "  .createServer((_req, res) => {",
    '    res.writeHead(200, { "Content-Type": "text/html" });',
    "    res.end(HTML);",
    "  })",
    '  .listen(PORT, "127.0.0.1", () => {',
    '    console.log("[otto-e2e-static-server] listening on " + PORT);',
    "  });",
    "",
  ].join("\n");
}

test("real Electron renders a live <webview> preview", async () => {
  test.setTimeout(180_000);

  const metroPort = Number(process.env.E2E_METRO_PORT);
  const daemonPort = Number(getE2EDaemonPort());
  const serverId = process.env.E2E_SERVER_ID;
  if (!metroPort || !serverId) {
    throw new Error(
      "E2E_METRO_PORT / E2E_SERVER_ID not set — globalSetup must run first (via playwright.demo-electron.config.ts).",
    );
  }

  const staticServerPort = await getAvailablePort();
  const launchConfig = {
    version: "0.0.1",
    configurations: [
      {
        name: "otto-e2e-static",
        runtimeExecutable: "node",
        runtimeArgs: ["server.cjs"],
        port: staticServerPort,
      },
    ],
  };

  const repo = await createTempGitRepo("otto-e2e-electron-preview-", {
    files: [
      { path: "server.cjs", content: buildStaticServerScript(staticServerPort) },
      { path: ".claude/launch.json", content: `${JSON.stringify(launchConfig, null, 2)}\n` },
    ],
  });

  const client = await connectDaemonClient<PreviewCapableClient>({
    clientIdPrefix: "demo-electron-smoke",
  });

  const outDir = path.resolve(__dirname, "../.out/electron-smoke");
  await mkdir(outDir, { recursive: true });

  let electronHandle: Awaited<ReturnType<typeof launchDesktopElectron>> | null = null;
  let startedPreviewServerId: string | null = null;
  let createdProjectId: string | null = null;

  try {
    const created = await client.createWorkspace({
      source: { kind: "directory", path: repo.path },
    });
    if (!created.workspace) {
      throw new Error(created.error ?? `Failed to create workspace at ${repo.path}`);
    }
    const workspace = created.workspace;
    createdProjectId = workspace.projectId;

    const agent = await client.createAgent({
      provider: "mock",
      cwd: repo.path,
      workspaceId: workspace.id,
      title: "Electron preview smoke",
      modeId: "load-test",
      model: "ten-second-stream",
    });

    electronHandle = await launchDesktopElectron({
      metroPort,
      daemonPort,
      serverId,
      // Logical (DIP) window size so the app lays out at a normal laptop
      // density; each shot below still resizes to full QHD via resizePngToTarget.
      windowSize: DESKTOP_LAYOUT_VIEWPORT,
    });
    const { window } = electronHandle;

    const agentRoute = buildHostAgentDetailRoute(serverId, agent.id, workspace.id);
    await window.goto(`http://localhost:${metroPort}${agentRoute}`, { timeout: 120_000 });
    await window.waitForURL(
      (url) => url.pathname.includes("/workspace/") && !url.searchParams.has("open"),
      { timeout: 60_000 },
    );

    const tabsRow = window.getByTestId("workspace-tabs-row").filter({ visible: true }).first();
    await expect(tabsRow).toBeVisible({ timeout: 30_000 });

    // First screenshot: proves this is genuinely Electron rendering the real
    // app shell (window chrome + workspace tabs), not the plain-Chromium demo
    // pipeline's static "browser unavailable" placeholder.
    const shellPath = path.join(outDir, "01-electron-app-shell.png");
    await window.screenshot({ path: shellPath });
    await resizePngToTarget(shellPath, DESKTOP_CAPTURE_RESOLUTION);

    const previewButton = window
      .getByTestId("workspace-preview-button")
      .filter({ visible: true })
      .first();
    await expect(previewButton).toBeVisible({ timeout: 30_000 });
    await expect(previewButton).toBeEnabled({ timeout: 30_000 });
    await previewButton.click();

    // Track the started server so cleanup can stop it explicitly rather than
    // relying on the e2e daemon's teardown to tree-kill it.
    await expect
      .poll(
        async () => {
          const config = await client.previewListConfig(repo.path);
          const running = config.runningServers?.find((s) => s.status !== "exited");
          if (running) {
            startedPreviewServerId = running.serverId;
          }
          return Boolean(running);
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    // The webview navigates once previewStatus flips to "ready" — wait for
    // the marker element the static server renders, proving real page
    // content loaded inside the <webview>, not a spinner or error state.
    await expect(async () => {
      const markerVisible = await window.evaluate(hasNavigatedWebview);
      expect(markerVisible).toBe(true);
    }).toPass({ timeout: 60_000 });

    // Give the guest page a moment to paint after navigation before capturing.
    await window.waitForTimeout(2_000);

    // Second screenshot: the actual deliverable — a real <webview> rendering
    // real dev-server content inside the real Otto UI chrome.
    const previewPath = path.join(outDir, "02-electron-webview-preview.png");
    await window.screenshot({ path: previewPath });
    await resizePngToTarget(previewPath, DESKTOP_CAPTURE_RESOLUTION);

    // Third capture: the full window as actually composited on screen,
    // including OS-drawn window chrome (Windows Window Controls Overlay
    // buttons) that a CDP-based page.screenshot() can never show — see
    // captureWindowWithChrome's docstring in e2e/helpers/electron-app.ts.
    // No targetSize here deliberately: this shot exists to prove OS chrome is
    // captured at all, and forcing it to the content-only DESKTOP_CAPTURE_RESOLUTION
    // would crop or distort the chrome pixels it's specifically there to show.
    await captureWindowWithChrome(
      electronHandle.app,
      path.join(outDir, "03-electron-window-with-chrome.png"),
    );
  } finally {
    if (startedPreviewServerId) {
      await client.previewStop(startedPreviewServerId).catch(() => undefined);
    }
    if (electronHandle) {
      await electronHandle.close().catch(() => undefined);
    }
    if (createdProjectId) {
      await client.removeProject(createdProjectId).catch(() => undefined);
    }
    await client.close().catch(() => undefined);
    await repo.cleanup().catch(() => undefined);
  }
});
