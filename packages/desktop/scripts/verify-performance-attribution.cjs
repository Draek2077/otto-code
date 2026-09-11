// Isolated Electron regression probe: no Otto daemon, user profile or visible window.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

if (!process.versions.electron) {
  const root = path.resolve(__dirname, "../../..");
  const scratchRoot = path.join(root, ".tmp");
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, "loaf-attribution-"));
  try {
    // Exercise the exact startup flag used by the app, including a control run.
    for (const enabled of [false, true]) {
      const child = spawnSync(require("electron"), [__filename, scratch, String(enabled)], {
        windowsHide: true,
        encoding: "utf8",
        timeout: 25000,
      });
      assert.equal(child.status, 0, child.error?.message ?? child.stderr + child.stdout);
      console.log(child.stdout.trim());
    }
  } finally {
    // scratch is the literal mkdtemp result beneath the resolved repo .tmp directory.
    assert.equal(path.dirname(scratch), scratchRoot);
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
} else {
  const { app, BrowserWindow, protocol } = require("electron");
  const enabled = process.argv[3] === "true";
  app.setPath("userData", path.join(process.argv[2], enabled ? "enabled" : "control"));
  if (enabled) app.commandLine.appendSwitch("enable-features", "AlwaysLogLOAFURL");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  protocol.registerSchemesAsPrivileged([
    { scheme: "otto", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
  app
    .whenReady()
    .then(async () => {
      protocol.handle(
        "otto",
        (request) =>
          new Response(
            request.url.endsWith("probe.js")
              ? `
      window.framesRecorded = [];
      new PerformanceObserver(list => window.framesRecorded.push(...list.getEntries().map(frame => ({
        duration: frame.duration,
        scripts: frame.scripts.map(script => ({sourceURL: script.sourceURL, duration: script.duration, sourceFunctionName: script.sourceFunctionName}))
      })))).observe({type: 'long-animation-frame'});
      window.runProbe = () => requestAnimationFrame(function diagnosticBusyFrame() {
        const until = performance.now() + 100;
        while (performance.now() < until) {}
        document.body.style.opacity = '0.99';
      });
    `
              : '<!doctype html><body>Capture probe<script src="otto://app/probe.js"></script></body>',
            {
              headers: {
                "Content-Type": request.url.endsWith("probe.js")
                  ? "application/javascript"
                  : "text/html",
              },
            },
          ),
      );
      const win = new BrowserWindow({
        show: false,
        webPreferences: { offscreen: true, backgroundThrottling: false },
      });
      await win.loadURL("otto://app/");
      let frames = [];
      for (let i = 0; i < 5 && frames.length === 0; i++) {
        await win.webContents.executeJavaScript("window.runProbe()");
        await new Promise((resolve) => setTimeout(resolve, 300));
        frames = await win.webContents.executeJavaScript("window.framesRecorded");
      }
      assert.ok(frames.length > 0, "The otto:// probe must produce a long animation frame");
      const attributed = frames
        .flatMap((frame) => frame.scripts)
        .filter((script) => script.sourceURL === "otto://app/probe.js");
      assert.equal(
        attributed.length > 0,
        enabled,
        "Script attribution must follow the Chromium flag",
      );
      console.log(
        JSON.stringify({
          enabled,
          longFrames: frames.length,
          attributedScripts: attributed.length,
          chromium: process.versions.chrome,
        }),
      );
      win.destroy();
      app.exit(0);
      return undefined;
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
