import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bundleDownloadPlan, downloadRepoFiles, pullModel } from "./download.js";
import type { CatalogModel } from "../config/schema.js";

const originalFetch = globalThis.fetch;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "otto-brain-download-"));

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
});

function model(): CatalogModel {
  return {
    id: "author/repo/model.gguf",
    name: "Test model",
    hfRepo: "author/repo",
    quantFile: "model.gguf",
    sizeBytes: 10,
    params: "test",
    tier: "test",
    useCases: [],
  } as CatalogModel;
}

test("resumes an ETag-verified partial with an exact byte range", async () => {
  const partial = path.join(root, "author", "repo", "model.gguf.part");
  fs.mkdirSync(path.dirname(partial), { recursive: true });
  fs.writeFileSync(partial, "hello");
  fs.writeFileSync(`${partial}.json`, JSON.stringify({ etag: '"v1"', totalBytes: 10 }));

  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("range"), "bytes=5-");
    assert.equal(headers.get("if-range"), '"v1"');
    return new Response("world", {
      status: 206,
      headers: { "content-length": "5", "content-range": "bytes 5-9/10", etag: '"v1"' },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const destination = await pullModel({ model: model(), destRoot: root });

  assert.equal(fs.readFileSync(destination, "utf8"), "helloworld");
  assert.ok(!fs.existsSync(partial));
  assert.ok(!fs.existsSync(`${partial}.json`));
  assert.equal(fetchMock.mock.calls.length, 1);
});

test("restarts rather than trusting an unidentified partial", async () => {
  const partial = path.join(root, "author", "repo", "model.gguf.part");
  fs.mkdirSync(path.dirname(partial), { recursive: true });
  fs.writeFileSync(partial, "unsafe");

  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("range"), null);
    return new Response("complete", {
      status: 200,
      headers: { "content-length": "8", etag: '"v2"' },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const destination = await pullModel({ model: model(), destRoot: root });

  assert.equal(fs.readFileSync(destination, "utf8"), "complete");
  assert.equal(fetchMock.mock.calls.length, 1);
});

test("drops a partial the server refuses to resume so the next attempt restarts", async () => {
  const partial = path.join(root, "author", "repo", "model.gguf.part");
  fs.mkdirSync(path.dirname(partial), { recursive: true });
  fs.writeFileSync(partial, "hello");
  fs.writeFileSync(`${partial}.json`, JSON.stringify({ etag: '"v1"', totalBytes: 10 }));

  // An expired signed CDN redirect answers the ranged request with a 403. Left
  // in place, the partial would replay that same request forever.
  const refused = vi.fn(async () => new Response("denied", { status: 403 }));
  vi.stubGlobal("fetch", refused);

  await assert.rejects(
    pullModel({ model: model(), destRoot: root }),
    /download resume failed \(403\)/,
  );
  assert.equal(refused.mock.calls.length, 1);
  assert.ok(!fs.existsSync(partial));
  assert.ok(!fs.existsSync(`${partial}.json`));

  const served = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("range"), null);
    assert.equal(headers.get("if-range"), null);
    return new Response("helloworld", {
      status: 200,
      headers: { "content-length": "10", etag: '"v2"' },
    });
  });
  vi.stubGlobal("fetch", served);

  const destination = await pullModel({ model: model(), destRoot: root });

  assert.equal(fs.readFileSync(destination, "utf8"), "helloworld");
  assert.equal(served.mock.calls.length, 1);
});

test("keeps a short range response as a partial instead of publishing it", async () => {
  const partial = path.join(root, "author", "repo", "model.gguf.part");
  const destination = path.join(root, "author", "repo", "model.gguf");
  fs.mkdirSync(path.dirname(partial), { recursive: true });
  fs.writeFileSync(partial, "hello");
  fs.writeFileSync(`${partial}.json`, JSON.stringify({ etag: '"v1"', totalBytes: 10 }));

  // A server may narrow an open-ended `bytes=5-` to any shorter valid range.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("wo", {
          status: 206,
          headers: { "content-length": "2", "content-range": "bytes 5-6/10", etag: '"v1"' },
        }),
    ),
  );

  await assert.rejects(
    pullModel({ model: model(), destRoot: root }),
    /download incomplete .*wrote 7 of 10 bytes/,
  );
  assert.ok(!fs.existsSync(destination));
  assert.equal(fs.readFileSync(partial, "utf8"), "hellowo");
  assert.ok(fs.existsSync(`${partial}.json`));

  // The bytes it did add are kept, so the next attempt resumes from byte 7.
  const rest = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("range"), "bytes=7-");
    return new Response("rld", {
      status: 206,
      headers: { "content-length": "3", "content-range": "bytes 7-9/10", etag: '"v1"' },
    });
  });
  vi.stubGlobal("fetch", rest);

  assert.equal(await pullModel({ model: model(), destRoot: root }), destination);
  assert.equal(fs.readFileSync(destination, "utf8"), "helloworld");
  assert.ok(!fs.existsSync(`${partial}.json`));
});

test("counts an already-downloaded bundle artifact toward aggregate progress", async () => {
  const existing = path.join(root, "author", "repo", "primary.gguf");
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, "old");
  const progress: number[] = [];
  const fetchMock = vi.fn(async () => new Response("new-data", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await downloadRepoFiles({
    repo: "author/repo",
    files: ["primary.gguf", "projector.gguf"],
    destRoot: root,
    onProgress: (event) => progress.push(event.receivedBytes),
  });

  assert.deepEqual(progress, [3, 11]);
  assert.equal(fetchMock.mock.calls.length, 1);
});

void originalFetch;

test("bundle plan downloads only the explicitly selected companion files", () => {
  const plan = bundleDownloadPlan(
    {
      ...model(),
      approxWeightsBytes: 100,
      components: [
        {
          id: "vision-projector",
          label: "Image understanding",
          description: "Reads images",
          role: "vision_projector",
          file: "mmproj.gguf",
          bytes: 20,
          required: false,
          defaultDownload: false,
          defaultLoad: true,
        },
        {
          id: "speculative-drafter",
          label: "Faster drafting",
          description: "Accelerates generation",
          role: "speculative_drafter",
          file: "draft.gguf",
          bytes: 10,
          required: false,
          defaultDownload: false,
          defaultLoad: true,
        },
      ],
    },
    ["speculative-drafter"],
  );
  assert.deepEqual(plan.files, ["model.gguf", "draft.gguf"]);
  assert.equal(plan.totalBytes, 110);
});

test("component-only bundle plans do not repeat already-complete required files", () => {
  const plan = bundleDownloadPlan(
    {
      ...model(),
      approxWeightsBytes: 100,
      components: [
        {
          id: "required-projector",
          label: "Image understanding",
          description: "Reads images",
          role: "vision_projector",
          file: "mmproj.gguf",
          bytes: 20,
          required: true,
          defaultDownload: true,
          defaultLoad: true,
        },
        {
          id: "speculative-drafter",
          label: "Faster drafting",
          description: "Accelerates generation",
          role: "speculative_drafter",
          file: "draft.gguf",
          bytes: 10,
          required: false,
          defaultDownload: false,
          defaultLoad: true,
        },
      ],
    },
    ["speculative-drafter"],
    [],
    0,
    false,
  );
  assert.deepEqual(plan.files, ["draft.gguf"]);
  assert.equal(plan.totalBytes, 10);
});
