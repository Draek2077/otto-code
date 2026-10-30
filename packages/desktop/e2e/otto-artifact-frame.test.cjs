const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createServer } = require("node:http");
const { once } = require("node:events");
const { WebSocketServer } = require("ws");
const { connectArtifactInspector } = require("./otto-artifact-frame.cjs");

// Protocol fixtures exercise the observer, not the app's preview sandbox.
async function fixture(t, parentContext, options = {}) {
  const calls = [];
  let frameTreeError = options.frameTreeError;
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}` }),
    );
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket) =>
    socket.on("message", (bytes) => {
      const request = JSON.parse(bytes.toString());
      calls.push(request);
      let result = {};
      let error;
      if (request.method === "Target.getTargets")
        result = {
          targetInfos: [
            { targetId: "parent", type: "page" },
            { targetId: "child", type: "iframe" },
          ],
        };
      if (request.method === "Target.attachToTarget")
        result = { sessionId: request.params.targetId };
      if (request.method === "Page.getFrameTree") {
        result = { frameTree: { frame: { id: request.sessionId } } };
        if (request.sessionId === "parent" && frameTreeError) {
          error = frameTreeError;
          frameTreeError = null;
        }
      }
      if (
        request.method === "Runtime.enable" &&
        (request.sessionId !== "parent" || parentContext !== 0)
      )
        socket.send(
          JSON.stringify({
            sessionId: request.sessionId,
            method: "Runtime.executionContextCreated",
            params: {
              context: {
                id: 100,
                uniqueId: request.sessionId + ":default",
                auxData: { frameId: request.sessionId, isDefault: true },
              },
            },
          }),
        );
      if (request.method === "Page.createIsolatedWorld") {
        result = { executionContextId: request.sessionId === "parent" ? parentContext : 17 };
        if (result.executionContextId)
          socket.send(
            JSON.stringify({
              sessionId: request.sessionId,
              method: "Runtime.executionContextCreated",
              params: {
                context: { id: result.executionContextId, uniqueId: request.sessionId + ":unique" },
              },
            }),
          );
      }
      if (request.method === "Runtime.evaluate") {
        if (request.sessionId === "parent")
          error = {
            code: -32000,
            message:
              parentContext === 1
                ? "Cannot find context with specified id"
                : "Unexpected protocol error",
          };
        else result = { result: { value: { title: "Packaged Artifact", wrapper: false } } };
      }
      socket.send(JSON.stringify({ id: request.id, ...(error ? { error } : { result }) }));
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const inspector = await connectArtifactInspector(server.address().port);
  t.after(async () => {
    inspector.close();
    for (const socket of sockets.clients) socket.terminate();
    await new Promise((resolve) => sockets.close(resolve));
    await new Promise((resolve) => server.close(resolve));
  });
  return {
    inspector,
    calls,
    detach(sessionId) {
      for (const socket of sockets.clients)
        socket.send(JSON.stringify({ method: "Target.detachedFromTarget", params: { sessionId } }));
    },
  };
}

test("a remote parent placeholder cannot hide the actual iframe target", async (t) => {
  const { inspector, calls } = await fixture(t, 0);
  const found = await inspector.frames();
  assert.ok(found.content);
  assert.equal(found.wrapper, undefined);
  assert.equal(calls.filter((call) => call.method === "Runtime.enable").length, 2);
  assert.equal(
    calls.some((call) => call.method === "Runtime.evaluate" && call.sessionId === "parent"),
    false,
  );
  assert.equal(
    calls.some((call) => call.method === "Page.createIsolatedWorld" && call.sessionId === "parent"),
    false,
  );
  const evaluation = calls.find(
    (call) => call.method === "Runtime.evaluate" && call.sessionId === "child",
  );
  assert.equal(evaluation.params.uniqueContextId, "child:unique");
  assert.equal(evaluation.params.contextId, undefined);
});

test("discovery skips a destroyed context and still inspects its actual owner", async (t) => {
  const { inspector } = await fixture(t, 1);
  assert.ok((await inspector.frames()).content);
});

test("other evaluation failures remain failures with the protocol method", async (t) => {
  const { inspector } = await fixture(t, 2);
  await assert.rejects(
    inspector.frames(),
    /Runtime.evaluate \(-32000\): Unexpected protocol error/,
  );
});

test("discovery evicts a detached session and reacquires it without skipping the actual iframe", async (t) => {
  const { inspector, calls } = await fixture(t, 1, {
    frameTreeError: { code: -32001, message: "Session with given id not found." },
  });
  assert.ok((await inspector.frames()).content);
  assert.ok((await inspector.frames()).content);
  assert.equal(
    calls.filter(
      (call) => call.method === "Target.attachToTarget" && call.params.targetId === "parent",
    ).length,
    2,
  );
});

test("detach events retire the cached session before the next discovery", async (t) => {
  const { inspector, calls, detach } = await fixture(t, 1);
  assert.ok((await inspector.frames()).content);
  detach("parent");
  assert.ok((await inspector.frames()).content);
  assert.equal(
    calls.filter(
      (call) => call.method === "Target.attachToTarget" && call.params.targetId === "parent",
    ).length,
    2,
  );
});

test("other frame-tree errors still fail discovery", async (t) => {
  const { inspector } = await fixture(t, 1, {
    frameTreeError: { code: -32001, message: "Unexpected protocol error" },
  });
  await assert.rejects(inspector.frames(), /Page.getFrameTree.*Unexpected protocol error/);
});
