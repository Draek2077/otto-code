// Paint and input regression against real Electron guest surfaces, without a daemon.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const rootDir = path.resolve(__dirname, "../../..");

if (!process.versions.electron) {
  const scratchRoot = path.join(rootDir, ".tmp");
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, "browser-layering-"));
  try {
    require("esbuild").buildSync({
      entryPoints: [path.join(__dirname, "fixtures/browser-layering.tsx")],
      bundle: true,
      format: "iife",
      globalName: "layering",
      jsx: "automatic",
      alias: { "@": path.join(rootDir, "packages/app/src") },
      define: { "process.env.NODE_ENV": '"production"' },
      outfile: path.join(scratch, "fixture.js"),
    });
    const child = spawnSync(require("electron"), [__filename, scratch], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 45_000,
    });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    console.log(child.stdout.trim());
  } finally {
    // mkdtemp produces this task's isolated, verified child of the repo scratch root.
    assert.equal(path.dirname(scratch), scratchRoot);
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
} else {
  const { app, BrowserWindow, webContents } = require("electron");
  const scratch = process.argv[2];
  app.setPath("userData", path.join(scratch, "profile"));
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
  app
    .whenReady()
    .then(run)
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });

  async function run() {
    const win = new BrowserWindow({
      width: 500,
      height: 400,
      show: false,
      webPreferences: { webviewTag: true, backgroundThrottling: false },
    });
    const host = win.webContents;
    host.on("console-message", (details) => {
      if (details.level === "error") console.error(details.message);
    });
    const guestUrl = `data:text/html,${encodeURIComponent('<body style="margin:0;height:100vh;background:rgb(200,0,200)" onclick="window.clicks=(window.clicks||0)+1"></body>')}`;
    await win.loadURL(
      `data:text/html,${encodeURIComponent('<body style="margin:0"><div id="root" style="position:fixed;inset:0;z-index:0"></div></body>')}`,
    );
    await host.executeJavaScript(fs.readFileSync(path.join(scratch, "fixture.js"), "utf8"));
    await host.executeJavaScript(`layering.render(false);
      const surface = document.createElement('div');
      surface.style.cssText = 'position:fixed;left:40px;top:40px;width:400px;height:280px';
      surface.style.zIndex = layering.WEB_SURFACE_PLANE.browser;
      const guest = document.createElement('webview');
      guest.style.cssText = 'display:flex;width:400px;height:280px';
      guest.src = ${JSON.stringify(guestUrl)};
      surface.appendChild(guest); document.body.appendChild(surface); true;`);
    let guest;
    for (let attempt = 0; attempt < 100; attempt++) {
      guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview");
      if (guest && !guest.isLoading() && guest.getURL() === guestUrl) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(guest, "Guest must attach");
    const guestId = guest.id;
    async function pixel(x, y) {
      host.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const capture = await host.capturePage({ x, y, width: 1, height: 1 }, { stayHidden: true });
      const bytes = capture.toBitmap();
      assert.ok(bytes.length >= 4, "Compositor must return pixels");
      return [bytes[2], bytes[1], bytes[0]];
    }
    assert.deepEqual(await pixel(110, 110), [200, 0, 200], "Reproduce pane UI hidden by browser");
    await host.executeJavaScript("layering.render(true)");
    assert.deepEqual(await pixel(110, 110), [0, 200, 0], "Pane overlay paints above guest");
    assert.deepEqual(await pixel(140, 160), [240, 200, 0], "Dragged tab paints above pane overlay");
    assert.deepEqual(await pixel(185, 160), [0, 0, 200], "Menu paints above dragged tab");
    assert.deepEqual(await pixel(80, 80), [200, 0, 200], "Uncovered guest remains visible");
    for (const type of ["mouseDown", "mouseUp"])
      host.sendInputEvent({ type, x: 200, y: 150, button: "left", clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await host.executeJavaScript("document.body.dataset.menuClicked"), "yes");
    assert.equal(await guest.executeJavaScript("window.clicks || 0"), 0);
    assert.equal(
      await host.executeJavaScript("document.elementFromPoint(80,80).tagName"),
      "WEBVIEW",
    );
    // Hidden windows do not reliably forward injected host clicks into guest
    // renderers. Host hit-testing above proves the exposed page is reachable;
    // dispatch trusted guest input separately to verify it remains operational.
    guest.debugger.attach("1.3");
    for (const type of ["mousePressed", "mouseReleased"]) {
      await guest.debugger.sendCommand("Input.dispatchMouseEvent", {
        type,
        x: 40,
        y: 40,
        button: "left",
        clickCount: 1,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await guest.executeJavaScript("window.clicks"), 1);
    await host.executeJavaScript("layering.render(false)");
    assert.deepEqual(await pixel(110, 110), [200, 0, 200]);
    assert.equal(guest.id, guestId, "UI overlays never replace the guest");
    console.log(
      "PASS: real guest occlusion reproduced; pane UI, drag preview, menu paint, host/guest clicks, and guest retention verified",
    );
    win.destroy();
    app.quit();
  }
}
