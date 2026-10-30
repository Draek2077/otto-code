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
  const contexts = new Map();
  socket.on("message", (bytes) => {
    const message = JSON.parse(bytes.toString());
    if (message.method === "Runtime.executionContextCreated") {
      let owned = contexts.get(message.sessionId);
      if (!owned) {
        owned = new Map();
        contexts.set(message.sessionId, owned);
      }
      owned.set(message.params.context.id, message.params.context);
      return;
    }
    if (message.method === "Runtime.executionContextDestroyed") {
      contexts.get(message.sessionId)?.delete(message.params.executionContextId);
      return;
    }
    if (message.method === "Runtime.executionContextsCleared") {
      contexts.delete(message.sessionId);
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error)
      request.reject(
        Object.assign(
          new Error(`${request.method} (${message.error.code}): ${message.error.message}`),
          {
            code: message.error.code,
            detail: message.error.message,
          },
        ),
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
  function frameHandle(sessionId, frameId) {
    const evaluate = async (expression) => {
      const { executionContextId } = await call(
        "Page.createIsolatedWorld",
        { frameId, worldName: "otto-artifact-observer" },
        sessionId,
      );
      const context = contexts.get(sessionId)?.get(executionContextId);
      if (!context?.uniqueId)
        throw Object.assign(new Error("Frame context is not owned by this target"), {
          contextUnavailable: true,
        });
      const reply = await call(
        "Runtime.evaluate",
        { expression, uniqueContextId: context.uniqueId, returnByValue: true },
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
    const handle = frameHandle(sessionId, tree.frame.id);
    let identity;
    try {
      identity = await handle.evaluate(
        "({title:document.title,wrapper:!!document.querySelector('iframe[title=\"Artifact content\"]')})",
      );
    } catch (error) {
      // Contexts may disappear while the renderer commits its iframe document.
      // Discovery will reacquire the live context; never ignore fixture actions
      // or security assertion failures after a real document has been selected.
      if (
        error.contextUnavailable ||
        error.detail === "Cannot find context with specified id" ||
        error.detail === "No frame for given id found"
      )
        return;
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
