import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, access } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import { downloadArchive } from "./browser-download.mjs";

async function fixture(t, handler) {
  const scratch = new URL("../.tmp/", import.meta.url);
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(new URL("browser-download-", scratch));
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/browser.zip`,
    file: path.join(directory, "browser.zip"),
  };
}
const options = { retryDelayMs: 1, timeoutMs: 5_000, report: () => {} };

test("retries a temporary CDN failure and writes the complete chunked response", async (t) => {
  let requests = 0;
  const f = await fixture(t, (_, response) => {
    if (++requests === 1) {
      response.writeHead(503);
      response.end("unavailable");
      return;
    }
    response.write("archive-");
    response.end("complete");
  });
  await downloadArchive(f.url, f.file, options);
  assert.equal(requests, 2);
  assert.equal(await readFile(f.file, "utf8"), "archive-complete");
});

test("retries an interrupted response without retaining partial archive bytes", async (t) => {
  let requests = 0;
  const f = await fixture(t, (_, response) => {
    if (++requests === 1) {
      response.writeHead(200, { "content-length": "100" });
      response.write("incomplete");
      setImmediate(() => response.destroy());
      return;
    }
    response.end("complete");
  });
  await downloadArchive(f.url, f.file, options);
  assert.equal(requests, 2);
  assert.equal(await readFile(f.file, "utf8"), "complete");
});

test("bounds retries and removes a failed download", async (t) => {
  let requests = 0;
  const f = await fixture(t, (_, response) => {
    requests++;
    response.writeHead(502);
    response.end();
  });
  await assert.rejects(downloadArchive(f.url, f.file, options), /after 3 attempt\(s\).*HTTP 502/);
  assert.equal(requests, 3);
  await assert.rejects(access(f.file), { code: "ENOENT" });
});

test("a permanent missing archive fails immediately", async (t) => {
  let requests = 0;
  const f = await fixture(t, (_, response) => {
    requests++;
    response.writeHead(404);
    response.end();
  });
  await assert.rejects(downloadArchive(f.url, f.file, options), /after 1 attempt\(s\).*HTTP 404/);
  assert.equal(requests, 1);
});
