import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { resolveBrainPaths } from "../config/paths.js";
import type { RunRecord } from "../ops/results.js";
import { put } from "../ops/archive.js";
import { TOOL_CASES } from "../bench/tasks.js";
import { renderResult } from "../output/render.js";
import { runReportCommand } from "./report.js";
import { runRescoreCommand } from "./rescore.js";

const roots: string[] = [];
const command = undefined as unknown as Command;
const output = { format: "table", quiet: false, noHeaders: false, noColor: true } as const;
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    const relative = path.relative(fixtureRoot(), root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture(seed = true) {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-offline-reports-"));
  roots.push(root);
  vi.stubEnv("OTTO_HOME", root);
  const paths = resolveBrainPaths({ OTTO_HOME: root });
  const archiveId = "fixture-archived-run";
  const record: RunRecord = {
    schema: 3,
    ranAt: "2026-10-23T00:00:00Z",
    configKey: "fixture-config",
    archiveId,
    model: {
      id: "fixture/model",
      displayName: "Fixture model",
      quant: null,
      arch: null,
      sizeBytes: null,
      publisher: null,
      features: null,
      contextLength: null,
      blockCount: null,
      headCountKv: null,
    },
    profile: null,
    setup: null,
    suite: null,
    gpu: null,
    system: null,
    runtime: null,
    overall: 0.5,
    grade: "partial",
    seconds: 1,
    executedCode: false,
    vramBytes: null,
    loadSeconds: null,
    tasks: [
      {
        id: "tool-calling",
        category: "tools",
        score: 0.5,
        weight: 1,
        summary: "fixture historical score",
        seconds: 1,
        detail: null,
        error: null,
      },
    ],
  };
  if (seed) {
    fs.mkdirSync(paths.resultsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.resultsDir, "fixture.json"), JSON.stringify(record));
    put(archiveId, "tool-calling", {
      request: { messages: [{ role: "user", content: TOOL_CASES[0]!.prompt }] },
      response: {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: "read_file",
                    arguments: JSON.stringify({ path: "src/config.py" }),
                  },
                },
              ],
            },
          },
        ],
      },
    });
    put(archiveId, "depth-scaling", { request: {}, response: {} });
  }
  return { root, paths, archiveId };
}

it("exports the real HTML report and returns aligned scores without a host or runtime", async () => {
  const f = fixture();
  const result = await runReportCommand({}, command);
  expect(result.type).toBe("single");
  if (result.type !== "single") throw new Error("Unexpected fixture output");
  expect(result.data).toMatchObject({
    file: path.join(f.paths.resultsDir, "report.html"),
    count: 1,
    models: [{ displayName: "Fixture model", overall: 0.5 }],
  });
  expect(fs.readFileSync(result.data.file, "utf8")).toContain("Fixture model");
  expect(fs.existsSync(f.paths.pidFile)).toBe(false);
  expect(renderResult(result, output)).toContain("50%");
  expect(JSON.parse(renderResult(result, { ...output, format: "json" })).count).toBe(1);
  expect(renderResult(result, { ...output, quiet: true })).toBe(result.data.file);
});

it("uses an explicit report destination and supports YAML and header-free output", async () => {
  const f = fixture();
  const target = path.join(f.root, "exports", "comparison.html");
  const result = await runReportCommand({ out: target }, command);
  expect(fs.existsSync(target)).toBe(true);
  expect(renderResult(result, { ...output, format: "yaml" })).toContain(
    "displayName: Fixture model",
  );
  expect(renderResult(result, { ...output, noHeaders: true })).not.toContain("overall");
});

it("regrades stored tool transcripts without rewriting scores or archived evidence", async () => {
  const f = fixture();
  const historical = fs.readFileSync(path.join(f.paths.resultsDir, "fixture.json"), "utf8");
  const beforeHandlers = process.listenerCount("SIGINT");
  const result = await runRescoreCommand({ run: f.archiveId, execute: false }, command);
  expect(result.type).toBe("list");
  expect(result.data).toMatchObject([
    {
      archiveId: f.archiveId,
      changed: 1,
      tasks: expect.arrayContaining([
        expect.objectContaining({ taskId: "tool-calling", before: 0.5, score: 1, changed: true }),
        expect.objectContaining({ taskId: "depth-scaling", score: null, changed: false }),
      ]),
    },
  ]);
  expect(fs.readFileSync(path.join(f.paths.resultsDir, "fixture.json"), "utf8")).toBe(historical);
  expect(process.listenerCount("SIGINT")).toBe(beforeHandlers);
  expect(fs.existsSync(f.paths.pidFile)).toBe(false);
  expect(renderResult(result, output)).toContain("<- CHANGED");
  expect(renderResult(result, { ...output, quiet: true })).toBe(f.archiveId);
  expect(JSON.parse(renderResult(result, { ...output, format: "json" }))[0].changed).toBe(1);
  expect(renderResult(result, { ...output, format: "yaml" })).toContain(
    "archiveId: fixture-archived-run",
  );
});

it("refuses unknown archive identities before replay", async () => {
  fixture();
  await expect(
    runRescoreCommand({ run: "../outside", execute: false }, command),
  ).rejects.toMatchObject({ code: "UNKNOWN_RUN" });
});

it("keeps empty-home report and replay failures free of configuration or host side effects", async () => {
  const f = fixture(false);
  await expect(runReportCommand({}, command)).rejects.toMatchObject({ code: "NO_RESULTS" });
  await expect(runRescoreCommand({ execute: false }, command)).rejects.toMatchObject({
    code: "NO_ARCHIVE",
  });
  expect(fs.existsSync(f.paths.root)).toBe(false);
});
