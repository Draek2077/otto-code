import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";

// Used by the real desktop bridge harness. Send native characters through the
// main process: Playwright typing would refocus the editor and mask this bug.
export async function verifyComposerFocus({
  page,
  client,
  serverId,
  targetUrl,
  callerAgentId,
  inspectorPort,
  expoPort,
  workspaceId,
  startupTimeoutMs,
  callBrowserTool,
}) {
  const targets = await (await fetch(`http://127.0.0.1:${inspectorPort}/json`)).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let requestId = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    pending.get(message.id)?.(message);
  });
  async function nativeEval(expression) {
    const id = ++requestId;
    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Native input inspector timed out"));
      }, 10_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        resolve(message);
      });
      socket.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: {
            expression,
            returnByValue: true,
            awaitPromise: true,
          },
        }),
      );
    });
    assert(!response.error && !response.result?.exceptionDetails, JSON.stringify(response));
    return response.result.result.value;
  }
  const host = `process.getBuiltinModule('module').createRequire(process.cwd() + '/index.cjs')('electron').webContents.getAllWebContents().find(c => c.getURL().includes('localhost:${expoPort}'))`;
  try {
    // The isolated desktop starts hidden; its renderer must still process input
    // at normal speed while the user continues working in the installed app.
    await nativeEval(`${host}.setBackgroundThrottling(false)`);
    const workspace = page.getByTestId(`sidebar-workspace-row-${serverId}:${workspaceId}`);
    await workspace.waitFor({ state: "visible", timeout: startupTimeoutMs });
    await workspace.click();
    await page
      .getByTestId(`workspace-tab-agent_${callerAgentId}`)
      .filter({ visible: true })
      .first()
      .click();
    const editor = page
      .getByRole("textbox", { name: "Message agent..." })
      .filter({ visible: true })
      .first();
    await editor.fill("draft ");
    await editor.evaluate((element) =>
      element.setSelectionRange(element.value.length, element.value.length),
    );
    const { browserId } = await callBrowserTool(client, "browser_new_tab", {
      url: targetUrl,
      layout: "split-right",
    });
    assert(
      await editor.evaluate((element) => document.activeElement === element),
      "Tab creation stole composer focus",
    );
    const snapshot = await client.callTool({ name: "browser_snapshot", args: { browserId } });
    const text = snapshot.content?.[0]?.text;
    const field = text?.match(/textbox "Automation field" \[ref=(@e\d+)\]/)?.[1];
    const button = text?.match(/button "Bridge target" \[ref=(@e\d+)\]/)?.[1];
    assert(field && button, `Missing input refs: ${text}`);
    const typed = "native keyboard stays in this composer while automation works";
    await Promise.all([
      (async () => {
        for (const keyCode of typed) {
          await nativeEval(`${host}.sendInputEvent(${JSON.stringify({ type: "char", keyCode })})`);
          await delay(30);
        }
      })(),
      (async () => {
        for (let i = 0; i < 3; i++) {
          await callBrowserTool(client, "browser_click", { browserId, ref: button });
          await callBrowserTool(client, "browser_fill", {
            browserId,
            ref: field,
            value: `browser ${i}`,
          });
          await callBrowserTool(client, "browser_keypress", { browserId, ref: field, key: "x" });
        }
      })(),
    ]);
    await delay(150);
    assert.equal(await editor.inputValue(), `draft ${typed}`, "Lost or misdirected native typing");
    assert(
      await editor.evaluate((element) => document.activeElement === element),
      "Composer lost focus",
    );
    const link = text?.match(/link "Open another tab" \[ref=(@e\d+)\]/)?.[1];
    assert(link, "Missing new-tab link ref");
    await callBrowserTool(client, "browser_click", { browserId, ref: link });
    const openedUrl = new URL("/?opened=1", targetUrl).href;
    let openedTab;
    for (let attempt = 0; attempt < 50; attempt++) {
      const listed = await callBrowserTool(client, "browser_list_tabs");
      openedTab = listed.tabs.find((tab) => tab.url === openedUrl);
      if (openedTab) break;
      await delay(100);
    }
    assert(openedTab, "Page-created background tab was not registered");
    assert(await editor.isVisible(), "Page-created tab hid the composer");
    assert(
      await editor.evaluate((element) => document.activeElement === element),
      "Page-created tab stole focus",
    );
    await callBrowserTool(client, "browser_snapshot", { browserId: openedTab.browserId });
    const focus = await client.callTool({ name: "browser_focus_tab", args: { browserId } });
    assert.equal(focus.structuredContent?.ok, false, "Agent focus bypassed editing protection");
    assert(
      await editor.evaluate((element) => document.activeElement === element),
      "Focus request stole composer",
    );
    return {
      passed: true,
      characters: typed.length,
      browserId,
      focusRejected: true,
      pageCreatedTab: openedTab.browserId,
    };
  } finally {
    socket.close();
  }
}
