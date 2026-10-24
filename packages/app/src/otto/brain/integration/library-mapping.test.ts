import { expect, test } from "vitest";
import { BrainEvalsSchema, BrainJobSchema } from "@getpaseo/protocol/otto/brain-library";
import { evalsToView, jobToView, quantsToView } from "./library-mapping";

test("historical benchmark fields stay unknown rather than acquiring current runtime defaults", () => {
  const data = BrainEvalsSchema.parse({
    rankings: [
      { id: "model", displayName: "Model", overall: 0.8, runs: 2, std: 0.01, grade: "strong" },
    ],
    variance: [],
    runCount: 2,
    latest: [
      {
        model: { id: "model", displayName: "Model" },
        configKey: "saved-config",
        ranAt: "2026-01-01",
        overall: 0.8,
        grade: "strong",
        seconds: 20,
        profile: { contextSize: 4096, cacheTypeK: "f16", cacheTypeV: "f16" },
        tasks: [{ id: "task", category: "coding", score: 0.8 }],
      },
    ],
  });
  const view = evalsToView(data);
  expect(view.latest[0]).toMatchObject({
    nativeContextLength: null,
    setup: null,
    suite: null,
    executedCode: null,
    profile: { contextSize: 4096, parallelSlots: null, temperature: null, preserveReasoning: null },
    tasks: [{ key: "task", seconds: null }],
  });
  expect(view.rankings[0]).toMatchObject({
    id: "model",
    name: "Model",
    rank: 1,
    runs: 2,
    std: 0.01,
  });
});
test("download progress and cancellation are projected from accepted host jobs", () => {
  const job = BrainJobSchema.parse({
    id: "job",
    operation: "pull",
    state: "running",
    subject: { modelId: null, catalogModelId: "catalog", repo: "owner/repo", quant: "Q4" },
    createdAt: "created",
    startedAt: null,
    finishedAt: null,
    error: null,
    progress: { phase: "download", receivedBytes: 25, totalBytes: 100 },
  });
  expect(jobToView(job)).toMatchObject({
    id: "job",
    status: "running",
    percent: 25,
    startedAt: "created",
    repo: "owner/repo",
    quant: "Q4",
  });
  expect(jobToView({ ...job, state: "canceled", finishedAt: "done" })).toMatchObject({
    status: "canceled",
    finishedAt: "done",
  });
});
test("quant choices keep actual installed model ids and owner-resolved projector state", () => {
  expect(
    quantsToView({
      repo: "owner/repo",
      quants: [
        {
          quant: "Q4",
          files: ["a.gguf", "b.gguf"],
          sizeBytes: 100,
          installed: true,
          modelId: "opaque-model",
        },
      ],
      mmproj: { files: ["projector.gguf"], sizeBytes: 20, installed: false },
    })[0],
  ).toMatchObject({
    quant: "Q4",
    files: 2,
    fileNames: ["a.gguf", "b.gguf"],
    modelId: "opaque-model",
    installed: true,
    projector: { file: "projector.gguf", installed: false },
  });
});
