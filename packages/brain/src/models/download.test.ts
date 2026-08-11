import { afterEach, test, vi } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bundleDownloadPlan, pullModel } from "./download.js";
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
