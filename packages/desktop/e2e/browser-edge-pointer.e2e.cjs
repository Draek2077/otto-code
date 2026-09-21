const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "../../..");

if (!process.versions.electron) {
  const scratchRoot = path.join(rootDir, ".tmp");
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, "browser-edge-pointer-"));
  try {
    const child = spawnSync(require("electron"), [__filename, scratch], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 45_000,
    });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    console.log(child.stdout.trim());
  } finally {
    assert.equal(path.dirname(scratch), scratchRoot);
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
} else {
  const { app, BrowserWindow, webContents } = require("electron");
  const scratch = process.argv[2];
  const preloadPath = path.join(
    rootDir,
    "packages/desktop/dist/features/browser-keyboard/guest-preload.js",
  );

  app.setPath("userData", path.join(scratch, "profile"));
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
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
      webPreferences: {
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.on("will-attach-webview", (_event, webPreferences, params) => {
      webPreferences.nodeIntegration = false;
      webPreferences.nodeIntegrationInSubFrames = true;
      webPreferences.nodeIntegrationInWorker = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      webPreferences.webviewTag = false;
      webPreferences.allowRunningInsecureContent = false;
      delete webPreferences.preload;
      delete params.preload;
      delete webPreferences.preloadURL;
      delete params.preloadURL;
      webPreferences.preload = preloadPath;
    });
    await win.loadURL(
      `data:text/html,${encodeURIComponent('<body style="margin:0"><webview id="guest" style="display:flex;width:400px;height:300px"></webview><script>window.edgeMessages=[];const guest=document.getElementById("guest");guest.addEventListener("ipc-message",event=>window.edgeMessages.push({channel:event.channel,args:event.args}));</script>')}`,
    );
    await win.webContents.executeJavaScript(
      `(() => { const guest = document.getElementById("guest"); guest.src = "data:text/html,<body style='margin:0'>edge probe</body>"; return true; })()`,
    );

    let guest;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      guest = webContents.getAllWebContents().find((item) => item.getType() === "webview");
      if (guest && !guest.isLoading()) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(guest, "Guest must attach");
    guest.debugger.attach("1.3");
    await guest.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 40,
      button: "none",
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const messages = await win.webContents.executeJavaScript("window.edgeMessages");
    assert.deepEqual(messages, [
      { channel: "otto-browser-edge-pointer", args: [{ x: 1, y: 40, buttons: 0 }] },
    ]);
    console.log("PASS: sandboxed browser preload forwards trusted edge movement to its host");
    win.destroy();
    app.quit();
  }
}
