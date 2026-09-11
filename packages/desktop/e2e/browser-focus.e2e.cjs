// Real Electron guests, with no daemon or visible application window.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const rootDir = path.resolve(__dirname, "../../..");

if (!process.versions.electron) {
  const scratchRoot = path.join(rootDir, ".tmp");
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, "browser-focus-"));
  try {
    require("esbuild").buildSync({
      entryPoints: [
        path.join(rootDir, "packages/app/src/desktop/browser/automation/focus-guard.web.ts"),
      ],
      bundle: true,
      format: "iife",
      globalName: "focusGuard",
      outfile: path.join(scratch, "guard.js"),
    });
    const child = spawnSync(require("electron"), [__filename, scratch], {
      windowsHide: true,
      encoding: "utf8",
      timeout: 30_000,
    });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    console.log(child.stdout.trim());
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
} else {
  const { app, BrowserWindow, webContents } = require("electron");
  const scratch = process.argv[2];
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
      show: false,
      webPreferences: { webviewTag: true, backgroundThrottling: false },
    });
    const host = win.webContents;
    const guestUrl = `data:text/html,${encodeURIComponent('<input id="field"><button>Next</button>')}`;
    await win.loadURL(
      `data:text/html,${encodeURIComponent(`<textarea id="chat">draft</textarea>
      <button id="menu">Responsive</button>
      <webview id="guest" data-otto-browser-id="browser" style="width:600px;height:400px" src="${guestUrl}"></webview>`)}`,
    );
    let guest;
    for (let attempt = 0; attempt < 100; attempt++) {
      guest = webContents.getAllWebContents().find((contents) => contents.getType() === "webview");
      if (guest && !guest.isLoading() && guest.getURL() === guestUrl) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(guest, "Guest must attach");
    guest.debugger.attach("1.3");
    await host.executeJavaScript(fs.readFileSync(path.join(scratch, "guard.js"), "utf8"));
    await host.executeJavaScript(`window.paneActivations = 0;
      document.querySelector('webview').addEventListener('focus', () => paneActivations++);`);

    async function clickGuest() {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await guest.debugger.sendCommand("Input.dispatchMouseEvent", {
          type,
          x: 30,
          y: 15,
          button: "left",
          clickCount: 1,
        });
      }
      // Guest focus notifications cross the renderer IPC boundary.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await host.executeJavaScript("document.querySelector('#chat').focus()");
    await clickGuest();
    assert.equal(await host.executeJavaScript("document.activeElement.id"), "guest");
    await host.executeJavaScript(`document.querySelector('#chat').focus(); paneActivations = 0;
      window.guarded = focusGuard.withBrowserAutomationFocus('browser', () => new Promise(resolve => window.finish = resolve)); true;`);
    await clickGuest();
    assert.equal(await host.executeJavaScript("document.activeElement.id"), "chat");
    await guest.debugger.sendCommand("Input.insertText", { text: "guest text" });
    assert.equal(
      await guest.executeJavaScript("document.querySelector('input').value"),
      "guest text",
    );
    await host.executeJavaScript("document.querySelector('#chat').setSelectionRange(5, 5)");
    for (const keyCode of " continued") host.sendInputEvent({ type: "char", keyCode });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      await host.executeJavaScript("document.querySelector('#chat').value"),
      "draft continued",
    );
    await host.executeJavaScript("document.querySelector('#menu').focus()");
    await clickGuest();
    assert.equal(await host.executeJavaScript("document.activeElement.id"), "menu");
    assert.equal(await host.executeJavaScript("paneActivations"), 0);
    await host.executeJavaScript("window.finish(); window.guarded");
    const point = await host.executeJavaScript(
      "(()=>{const r=document.querySelector('webview').getBoundingClientRect();return {x:Math.round(r.x+30),y:Math.round(r.y+15)}})()",
    );
    host.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
    host.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await host.executeJavaScript("document.activeElement.id"), "guest");
    console.log(
      "PASS: native focus theft reproduced; chat typing, guest input, menu focus, and cleanup verified",
    );
    win.destroy();
    app.quit();
  }
}
