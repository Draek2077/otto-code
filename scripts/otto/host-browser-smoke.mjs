// Real packaged modules and the distribution's Chromium. CI only, without a daemon or model.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

if (process.env.CI !== "true") throw new Error("Packaged browser acceptance runs only in CI.");
if (!process.argv[2] || !path.isAbsolute(process.argv[2]))
  throw new Error("Pass the installed server's absolute dist/server directory.");
const moduleRoot = await realpath(process.argv[2]);
const [{ createNativeHostBrowser }, { BrowserToolsBroker }] = await Promise.all([
  import(pathToFileURL(path.join(moduleRoot, "server/otto/browser/host/native.js")).href),
  import(pathToFileURL(path.join(moduleRoot, "server/browser-tools/broker.js")).href),
]);
const root = path.resolve(process.env.RUNNER_TEMP ?? ".tmp", "otto-packaged-browser-proof");
await mkdir(root, { recursive: true });
const home = await mkdtemp(path.join(root, "profile-"));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>Packaged Otto</title><h1>Packaged Host Browser</h1>");
});
const broker = new BrowserToolsBroker({ ottoNewTabHostId: () => "otto-host-browser" });
const service = createNativeHostBrowser({
  home,
  hostId: "package-proof",
  broker,
  reportError: (error) => console.error(error), // Only this fresh CI profile/local fixture can launch here.
  workspaces: {
    get: async (id) => (id === "fixture" ? { cwd: home, archivedAt: null } : null),
  },
});
service.register();
const failures = [];
let proof;
async function execute(command) {
  const response = await broker.execute({ cwd: home, workspaceId: "fixture", command });
  assert.equal(response.ok, true, `Packaged ${command.command} failed`);
  assert.equal(response.result.command, command.command);
  return response.result;
}
try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const tab = await execute({
    command: "new_tab",
    args: { url: `http://127.0.0.1:${address.port}` },
  });
  const evaluated = await execute({
    command: "evaluate",
    args: {
      browserId: tab.browserId,
      function: "() => document.querySelector('h1').textContent",
    },
  });
  assert.equal(JSON.parse(evaluated.resultJson), "Packaged Host Browser");
  const screenshot = await execute({ command: "screenshot", args: { browserId: tab.browserId } });
  assert.equal(screenshot.mimeType, "image/png");
  assert.equal(
    Buffer.from(screenshot.dataBase64, "base64").subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
  );
  assert(screenshot.width > 0 && screenshot.height > 0);
  proof = { packagedHostBrowser: "passed", width: screenshot.width, height: screenshot.height };
} catch (error) {
  failures.push(error);
} finally {
  // A failed browser close retains its profile for diagnostics; never unlink a live profile.
  try {
    await service.close();
    const actual = await realpath(home);
    assert.equal(path.dirname(actual), await realpath(root));
    assert(path.basename(actual).startsWith("profile-"));
    await rm(actual, { recursive: true, force: true });
  } catch (error) {
    failures.push(error);
  }
  if (server.listening) {
    try {
      await promisify(server.close.bind(server))();
    } catch (error) {
      failures.push(error);
    }
  }
}
if (failures.length)
  throw new AggregateError(failures, "Packaged Host Browser acceptance failed", {
    cause: failures[0],
  });
console.log(JSON.stringify(proof));
