const { WebSocket } = require("ws");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");

// Playwright's CDP frame tree omits custom-scheme OOPIFs in packaged Electron.
// Inspect the actual renderer targets, without weakening the app's isolation.
async function connectArtifactInspector(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Packaged CDP endpoint unavailable");
  const version = await response.json();
  const socket = new WebSocket(version.webSocketDebuggerUrl, { handshakeTimeout: 10000 });
  await once(socket, "open");
  let sequence = 0;
  const pending = new Map();
  const sessions = new Map();
  socket.on("message", (bytes) => {
    const message = JSON.parse(bytes.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error)
      request.reject(
        Object.assign(new Error(`${request.method}: ${message.error.message}`), {
          code: message.error.code,
          detail: message.error.message,
        }),
      );
    else request.resolve(message.result);
  });
  function call(method, params = {}, sessionId) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Packaged CDP timed out: ${method}`));
      }, 10000);
      pending.set(id, { resolve, reject, timer, method });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  function frameHandle(sessionId, contextId) {
    const evaluate = async (expression) => {
      const reply = await call(
        "Runtime.evaluate",
        { expression, contextId, returnByValue: true },
        sessionId,
      );
      if (reply.exceptionDetails) throw new Error("Packaged frame inspection failed");
      return reply.result.value;
    };
    return {
      evaluate,
      async click(label) {
        const point = await evaluate(
          `(() => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === ${JSON.stringify(label)}); if (!button) throw new Error('Missing fixture button'); const rect = button.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`,
        );
        await call(
          "Input.dispatchMouseEvent",
          { type: "mousePressed", ...point, button: "left", clickCount: 1 },
          sessionId,
        );
        await call(
          "Input.dispatchMouseEvent",
          { type: "mouseReleased", ...point, button: "left", clickCount: 1 },
          sessionId,
        );
      },
    };
  }
  async function inspectTree(tree, sessionId, found) {
    let executionContextId;
    try {
      ({ executionContextId } = await call(
        "Page.createIsolatedWorld",
        { frameId: tree.frame.id, worldName: "otto-artifact-observer" },
        sessionId,
      ));
    } catch (error) {
      // A parent tree can contain an OOPIF owned by another target. That target
      // is inspected separately; both real fixture documents are still required.
      if (error.code === -32000) return;
      throw error;
    }
    // A parent target can expose a remote-frame placeholder with context id 0.
    // It is not an execution context in this session. Its owning iframe target
    // must still supply the real document before the acceptance can proceed.
    if (!executionContextId) return;
    const handle = frameHandle(sessionId, executionContextId);
    let identity;
    try {
      identity = await handle.evaluate(
        "({title:document.title,wrapper:!!document.querySelector('iframe[title=\"Artifact content\"]')})",
      );
    } catch (error) {
      // Contexts may disappear while the renderer commits its iframe document.
      // Discovery will reacquire the live context; never ignore fixture actions
      // or security assertion failures after a real document has been selected.
      if (error.code === -32000 && error.detail === "Cannot find context with specified id") return;
      throw error;
    }
    found.observed.push({ ...identity, frameId: tree.frame.id });
    if (identity.title === "Packaged Artifact") found.content = handle;
    if (identity.wrapper) found.wrapper = handle;
    for (const child of tree.childFrames ?? []) await inspectTree(child, sessionId, found);
  }
  return {
    async frames() {
      const { targetInfos } = await call("Target.getTargets");
      const targets = targetInfos.filter(
        (target) => target.type === "iframe" || target.type === "page",
      );
      if (targets.length > 32) throw new Error("Unexpected packaged renderer target count");
      const found = { observed: [] };
      for (const target of targets) {
        let sessionId = sessions.get(target.targetId);
        if (!sessionId) {
          const attached = await call("Target.attachToTarget", {
            targetId: target.targetId,
            flatten: true,
          });
          sessionId = attached.sessionId;
          sessions.set(target.targetId, sessionId);
          await call("Runtime.enable", {}, sessionId);
        }
        const { frameTree } = await call("Page.getFrameTree", {}, sessionId);
        await inspectTree(frameTree, sessionId, found);
      }
      return found;
    },
    close() {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Packaged observer closed"));
      }
      pending.clear();
      socket.terminate();
    },
  };
}
async function waitForArtifactObservation(observe, expected) {
  const deadline = Date.now() + 15000;
  let last;
  while (Date.now() < deadline) {
    last = await observe();
    if (expected(last)) return last;
    await delay(100);
  }
  throw new Error(`Packaged Artifact observation failed: ${JSON.stringify(last)}`);
}
module.exports = { connectArtifactInspector, waitForArtifactObservation };
