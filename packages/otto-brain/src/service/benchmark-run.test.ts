import { expect, it } from "vitest";
import type { SuiteReport } from "../bench/index.js";
import type { Task } from "../bench/tasks.js";
import { BenchmarkOptionsSchema, type BenchmarkOptions } from "./benchmark-options.js";
import { publicBenchmarkReport, runOwnedBenchmark } from "./benchmark-run.js";

const report: SuiteReport = {
  overall: 1,
  grade: "A",
  seconds: 1,
  executedCode: false,
  pythonVersion: null,
  archiveId: "fixture",
  ranAt: "2026-10-23T00:00:00Z",
  results: [],
};
const options: BenchmarkOptions = {
  execute: false,
  depths: [1000, 16000],
  only: ["fixture"],
  concurrency: 2,
  repository: {
    directory: "/explicit-owner-fixture",
    workspace: "fixture-workspace",
    workspaceDirectory: "packages/fixture",
    ref: "fixture-ref",
    maxTasks: 2,
  },
};
const task: Task = {
  id: "fixture",
  category: "Fixture",
  description: "Fixture",
  weight: 1,
  run: async () => ({ score: 1, summary: "Fixture" }),
};
it("does not mine repositories for an ordinary benchmark and forwards explicit suite controls", async () => {
  let calls = 0;
  await runOwnedBenchmark(
    { execute: false, depths: [1000], concurrency: 2 },
    { host: "127.0.0.1", port: 1234 },
    {
      env: { OTTO_HOME: "/fixture" },
      loadRepoTasks: async () => {
        throw new Error("Unexpected repository access");
      },
      runSuite: async (value) => {
        calls++;
        expect(value).toMatchObject({
          host: "127.0.0.1",
          port: 1234,
          env: { OTTO_HOME: "/fixture" },
          execute: false,
          depths: [1000],
          concurrency: 2,
        });
        expect(value!.tasks).toBeUndefined();
        return report;
      },
    },
  );
  expect(calls).toBe(1);
});
it("passes owner identity and cancellation into mining, then disposes after all suite work", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  expect(
    await runOwnedBenchmark(
      options,
      { signal: controller.signal },
      {
        env: { OTTO_HOME: "/owner-fixture" },
        loadRepoTasks: async (value) => {
          expect(value).toMatchObject({
            dir: "/explicit-owner-fixture",
            workspace: "fixture-workspace",
            workspaceDir: "packages/fixture",
            ref: "fixture-ref",
            maxTasks: 2,
            signal: controller.signal,
            env: { OTTO_HOME: "/owner-fixture" },
          });
          events.push("mine");
          return {
            tasks: [task],
            dispose: () => {
              events.push("dispose");
            },
          };
        },
        runSuite: async (value) => {
          expect(value!.tasks).toEqual([task]);
          expect(value!.only).toEqual(["fixture"]);
          events.push("suite");
          return report;
        },
      },
    ),
  ).toEqual(report);
  expect(events).toEqual(["mine", "suite", "dispose"]);
});
it("preserves both a suite failure and owned-checkout cleanup failure", async () => {
  const primary = new Error("fixture suite");
  const cleanup = new Error("fixture cleanup");
  await expect(
    runOwnedBenchmark(
      options,
      {},
      {
        env: {},
        loadRepoTasks: async () => ({
          tasks: [task],
          dispose: () => {
            throw cleanup;
          },
        }),
        runSuite: async () => {
          throw primary;
        },
      },
    ),
  ).rejects.toMatchObject({ errors: [primary, cleanup], cause: primary });
});
it("disposes an empty mined checkout without silently running the static suite", async () => {
  let disposals = 0;
  await expect(
    runOwnedBenchmark(
      options,
      {},
      {
        env: {},
        loadRepoTasks: async () => ({
          tasks: [],
          dispose: () => {
            disposals++;
          },
        }),
        runSuite: async () => {
          throw new Error("Unexpected static suite");
        },
      },
    ),
  ).rejects.toThrow("No mineable");
  expect(disposals).toBe(1);
});
it("retains measured depth rates while removing native failures and other private task detail", () => {
  const value = publicBenchmarkReport({
    ...report,
    results: [
      {
        id: "context-depth",
        category: "Depth",
        weight: 1,
        score: 1,
        summary: "Measured",
        seconds: 1,
        error: null,
        detail: [
          {
            promptTokens: 1000,
            ttftSeconds: 0.1,
            generatePerSecond: 12,
            privatePath: "private fixture",
          },
        ],
      },
      {
        id: "failed",
        category: "Failure",
        weight: 1,
        score: 0,
        summary: "private fixture summary",
        error: "private fixture error",
        seconds: 0,
        detail: { credential: "private fixture" },
      },
    ],
  });
  expect(value.results[0]!.detail).toEqual([
    { promptTokens: 1000, ttftSeconds: 0.1, promptPerSecond: null, generatePerSecond: 12 },
  ]);
  expect(value.results[1]).toMatchObject({
    summary: "Brain benchmark task failed",
    error: "Brain benchmark task failed",
    detail: null,
  });
  expect(JSON.stringify(value)).not.toContain("private fixture");
});
it.each([
  { concurrency: 0 },
  { depths: [NaN] },
  { depths: [0] },
  { only: [] },
  { unknown: "value" },
  { repository: { ...options.repository, maxTasks: 101 } },
])("rejects unbounded or malformed benchmark controls %j", (value) => {
  expect(BenchmarkOptionsSchema.safeParse(value).success).toBe(false);
});
