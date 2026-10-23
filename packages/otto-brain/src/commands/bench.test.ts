import path from "node:path";
import { expect, it } from "vitest";
import { parseBenchOptions, parseBenchmarkEndpoint, runHostedBenchmarks } from "./bench.js";
import type { HostCommandPort } from "./host-command.js";

it("preserves suite controls and resolves explicit repository identity without touching its checkout", () => {
  const cwd = path.resolve(".tmp/benchmark-option-fixture");
  expect(
    parseBenchOptions(
      {
        execute: false,
        depths: "1000, 16000",
        only: "tool-use,context-depth",
        concurrency: "2",
        repoDir: "source",
        repoWorkspace: "fixture",
        repoWorkspaceDir: "packages/fixture",
        repoRef: "fixture-ref",
        repoMax: "7",
      },
      cwd,
    ),
  ).toEqual({
    execute: false,
    depths: [1000, 16000],
    only: ["tool-use", "context-depth"],
    concurrency: 2,
    repository: {
      directory: path.resolve(cwd, "source"),
      workspace: "fixture",
      workspaceDirectory: "packages/fixture",
      ref: "fixture-ref",
      maxTasks: 7,
    },
  });
});
it("keeps curated presets explicit and requires a source repository", () => {
  expect(() => parseBenchOptions({ curated: "brain" }, process.cwd())).toThrow("--repo-dir");
  expect(() => parseBenchOptions({ curated: "absent", repoDir: "fixture" }, process.cwd())).toThrow(
    "Available",
  );
  expect(
    parseBenchOptions({ curated: "brain", repoDir: "fixture" }, process.cwd()).repository,
  ).toMatchObject({
    workspace: "@otto-code/brain",
    workspaceDirectory: "packages/brain",
    ref: "origin/main",
    maxTasks: 3,
  });
});
it.each([
  { depths: "1000," },
  { depths: "" },
  { depths: "NaN" },
  { concurrency: "0" },
  { concurrency: "65" },
  { only: "a," },
  { repoWorkspaceDir: "packages/fixture" },
])("rejects invalid controls instead of silently changing their meaning %j", (value) => {
  expect(() => parseBenchOptions(value, process.cwd())).toThrow();
});
it("parses endpoint ports including HTTP's normalized port 80 and bracketed IPv6", () => {
  expect(parseBenchmarkEndpoint("localhost:80", 1250)).toEqual({ host: "localhost", port: 80 });
  expect(parseBenchmarkEndpoint("localhost", 1250)).toEqual({ host: "localhost", port: 1250 });
  expect(parseBenchmarkEndpoint("[::1]:8080", 1250)).toEqual({ host: "::1", port: 8080 });
});
it.each([
  "https://host:443",
  "http://user:secret@host:1234",
  "host:0",
  "host:65536",
  "host:1234/path",
])("rejects an unsupported or ambiguous endpoint %s", (value) => {
  expect(() => parseBenchmarkEndpoint(value, 1250)).toThrow();
});
it("benchmarks multiple selected models serially through their canonical host identities", async () => {
  const admissions: string[] = [];
  const report = {
    overall: 1,
    grade: "A",
    seconds: 0,
    executedCode: false,
    pythonVersion: null,
    archiveId: "fixture",
    ranAt: "2026-10-23T00:00:00Z",
    results: [],
  };
  const port: HostCommandPort = {
    instanceId: "fixture",
    request: async (route, _signal, body) => {
      if (route.endsWith("capabilities"))
        return { jobs: true, events: true, inventory: true, benchmarkOptions: true };
      if (route.endsWith("models"))
        return {
          models: [
            { id: "owner/alpha", displayName: "Alpha" },
            { id: "owner/beta", displayName: "Beta" },
          ],
          lastModelId: null,
        };
      if (route === "/__host/jobs") {
        if (
          !body ||
          typeof body !== "object" ||
          !("modelId" in body) ||
          typeof body.modelId !== "string"
        )
          throw new Error("Invalid fixture admission");
        admissions.push(body.modelId);
        return { job: { id: body.modelId } };
      }
      const id = new URL(route, "http://fixture").searchParams.get("id");
      return {
        job: {
          id,
          state: "completed",
          progress: null,
          error: null,
          result: {
            report,
            profile: {
              contextSize: 4096,
              cacheTypeK: "q8_0",
              cacheTypeV: "q8_0",
              reasoningBudget: 128,
              vision: false,
            },
          },
        },
      };
    },
    events: (_receive, signal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  };
  const result = await runHostedBenchmarks(
    port,
    { execute: false },
    ["Alpha", "Beta"],
    new AbortController().signal,
  );
  expect(admissions).toEqual(["owner/alpha", "owner/beta"]);
  expect(result.map((row) => row.modelName)).toEqual(["Alpha", "Beta"]);
  expect(result[0]!.profile).toMatchObject({ contextSize: 4096, reasoningBudget: 128 });
});
