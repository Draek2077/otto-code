import path from "node:path";
import { expect, it } from "vitest";
import { CatalogModelSchema } from "../config/schema.js";
import type { DownloadFilesOptions } from "../models/download.js";
import { BrainJobs } from "./jobs.js";
import { ModelAcquisition, type ModelAcquisitionPorts } from "./model-acquisition.js";

function fixture(overrides: Partial<ModelAcquisitionPorts> = {}) {
  const jobs = new BrainJobs(() => {});
  const calls: DownloadFilesOptions[] = [];
  const catalog = [
    CatalogModelSchema.parse({
      id: "fixture/catalog",
      name: "Fixture",
      hfRepo: "fixture/repo",
      quant: "Q4_K_M",
      quantFile: "model-Q4_K_M.gguf",
      approxWeightsBytes: 10,
    }),
  ];
  let changes = 0;
  const service = new ModelAcquisition({
    jobs,
    catalog: () => catalog,
    destination: () => path.resolve(".tmp/model-acquisition-fixture"),
    token: () => "private fixture credential",
    quants: async (repo, token, signal) => {
      expect(token).toBe("private fixture credential");
      signal.throwIfAborted();
      return {
        repo,
        quants: [
          {
            quant: "Q8_0",
            files: ["model-Q8_0-00001.gguf", "model-Q8_0-00002.gguf"],
            sizeBytes: 20,
          },
        ],
        mmproj: { files: ["mmproj.gguf"], sizeBytes: 5 },
      };
    },
    search: async (_query, _limit, _token, signal) => {
      signal.throwIfAborted();
      return [];
    },
    download: async (options) => {
      calls.push(options);
      options.onProgress?.({ file: "private fixture path", receivedBytes: 25 });
      return [];
    },
    changed: () => {
      changes++;
    },
    requireWrite: () => {},
    ...overrides,
  });
  return { service, jobs, calls, catalog, changes: () => changes };
}
it("plans catalog downloads on the owner and reports progress without its credential or file path", async () => {
  const value = fixture();
  const { job } = value.service.pull({ modelId: "fixture/catalog" });
  const result = await value.jobs.wait(job.id);
  expect(result).toMatchObject({
    state: "completed",
    subject: { catalogModelId: "fixture/catalog", repo: "fixture/repo" },
    progress: { phase: "downloading", receivedBytes: 25, totalBytes: 10 },
    result: { files: ["model-Q4_K_M.gguf"], totalBytes: 10 },
  });
  expect(value.calls[0]).toMatchObject({
    repo: "fixture/repo",
    token: "private fixture credential",
  });
  expect(value.changes()).toBe(1);
  expect(JSON.stringify(result)).not.toContain("private fixture");
  await value.jobs.close();
});
it("keeps selected quant shards with the repository's shared projector", async () => {
  const value = fixture();
  const { job } = value.service.pull({ modelId: "fixture/catalog", quant: "q8_0" });
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { totalBytes: 25 },
  });
  expect(value.calls[0]!.files).toEqual([
    "model-Q8_0-00001.gguf",
    "model-Q8_0-00002.gguf",
    "mmproj.gguf",
  ]);
  await value.jobs.close();
});
it("uses explicit bundle components rather than a generic discovery projector", async () => {
  const value = fixture();
  value.catalog[0]!.components = [
    {
      id: "vision",
      label: "Vision",
      description: "Fixture",
      role: "vision_projector",
      file: "bundle/vision.gguf",
      bytes: 7,
      required: true,
      defaultDownload: false,
      defaultLoad: false,
    },
  ];
  const { job } = value.service.pull({ modelId: "fixture/catalog", quant: "Q8_0" });
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { totalBytes: 27 },
  });
  expect(value.calls[0]!.files).toEqual([
    "model-Q8_0-00001.gguf",
    "model-Q8_0-00002.gguf",
    "bundle/vision.gguf",
  ]);
  await value.jobs.close();
});
it("supports component-only catalog acquisition without pulling the primary model", async () => {
  const value = fixture();
  value.catalog[0]!.components = [
    {
      id: "vision",
      label: "Vision",
      description: "Fixture",
      role: "vision_projector",
      file: "vision.gguf",
      bytes: 7,
      required: false,
      defaultDownload: false,
      defaultLoad: false,
    },
  ];
  const { job } = value.service.pull({
    modelId: "fixture/catalog",
    componentsOnly: true,
    components: ["vision"],
  });
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "completed",
    result: { files: ["vision.gguf"], totalBytes: 7 },
  });
  await value.jobs.close();
});
it.each([
  { primaryOnly: true, files: ["model-Q8_0-00001.gguf", "model-Q8_0-00002.gguf"], bytes: 20 },
  { componentsOnly: true, components: ["vision-projector"], files: ["mmproj.gguf"], bytes: 5 },
])(
  "preserves direct-repository primary and component selections: %j",
  async ({ files, bytes, ...selection }) => {
    const value = fixture();
    const { job } = value.service.add({ repo: "fixture/direct", quant: "Q8_0", ...selection });
    expect(await value.jobs.wait(job.id)).toMatchObject({
      state: "completed",
      subject: { catalogModelId: null, repo: "fixture/direct" },
      result: { files, totalBytes: bytes },
    });
    await value.jobs.close();
  },
);
it("rejects unsafe paths before downloading and does not expose the native error", async () => {
  const value = fixture();
  const { job } = value.service.pull({ modelId: "fixture/catalog", file: "../../outside.gguf" });
  expect(await value.jobs.wait(job.id)).toMatchObject({
    state: "failed",
    error: "Brain operation failed",
  });
  expect(value.calls).toEqual([]);
  expect(value.changes()).toBe(0);
  await value.jobs.close();
});
it("rejects a catalog entry without an explicit or derivable GGUF file before transfer", async () => {
  const value = fixture();
  delete value.catalog[0]!.quantFile;
  const { job } = value.service.pull({ modelId: "fixture/catalog" });
  expect(await value.jobs.wait(job.id)).toMatchObject({ state: "failed" });
  expect(value.calls).toEqual([]);
  await value.jobs.close();
});
it("does not admit invalid selections or accept client destinations and credentials", () => {
  const value = fixture();
  expect(() => value.service.add({ repo: "../escape", quant: "Q8_0" })).toThrow();
  expect(() =>
    value.service.add({ repo: "fixture/repo", quant: "Q8_0", token: "caller token" }),
  ).toThrow();
  expect(() =>
    value.service.pull({ modelId: "fixture/catalog", destRoot: "caller path" }),
  ).toThrow();
  expect(() =>
    value.service.pull({ modelId: "fixture/catalog", file: "model.gguf", quant: "Q8_0" }),
  ).toThrow();
  expect(() => value.service.pull({ modelId: "absent" })).toThrow();
  expect(value.jobs.list()).toEqual([]);
});
it("holds one repository admission through download and propagates explicit job cancellation", async () => {
  const value = fixture({
    download: (options) =>
      new Promise<string[]>((_resolve, reject) => {
        options.signal!.addEventListener("abort", () => reject(options.signal!.reason), {
          once: true,
        });
      }),
  });
  const { job } = value.service.pull({ modelId: "fixture/catalog" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(() => value.service.add({ repo: "fixture/repo", quant: "Q8_0" })).toThrow(
    "already active",
  );
  value.jobs.cancel(job.id);
  expect(await value.jobs.wait(job.id)).toMatchObject({ state: "canceled" });
  expect(value.changes()).toBe(1);
  const next = value.service.pull({ modelId: "fixture/catalog" });
  value.jobs.cancel(next.job.id);
  expect(await value.jobs.wait(next.job.id)).toMatchObject({ state: "canceled" });
  const retry = value.service.pull({ modelId: "fixture/catalog" });
  value.jobs.cancel(retry.job.id);
  await value.jobs.close();
});
it("refuses missing quants without downloading and bounds discovery input", async () => {
  const value = fixture();
  const { job } = value.service.add({ repo: "fixture/repo", quant: "absent" });
  expect(await value.jobs.wait(job.id)).toMatchObject({ state: "failed" });
  expect(value.calls).toEqual([]);
  await expect(value.service.search("query", 101, new AbortController().signal)).rejects.toThrow();
  await expect(value.service.quants("../repo", new AbortController().signal)).rejects.toThrow();
  await value.jobs.close();
});
