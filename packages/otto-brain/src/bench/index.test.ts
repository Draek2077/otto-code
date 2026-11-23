import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { runSuite, type ProgressEvent } from "./index.js";
import { load as loadArchive } from "../ops/archive.js";
import type { Task } from "./tasks.js";

const roots: string[] = [];
function home() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-benchmark-"));
  roots.push(root);
  return { OTTO_HOME: root };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("runs weighted tasks with the supplied context and archives their actual exchanges", async () => {
  const env = home();
  const progress: ProgressEvent[] = [];
  const tasks: Task[] = [
    {
      id: "light",
      category: "Light",
      description: "Fixture",
      weight: 1,
      async run(context) {
        expect(context.execute).toBe(false);
        expect(context.contextWindow).toBe(32768);
        const reply = await context.chat({
          messages: [{ role: "user", content: "fixture request" }],
        });
        expect(reply.choices?.[0].message?.content).toBe("fixture response");
        return { score: 0.5, summary: "partial" };
      },
    },
    {
      id: "heavy",
      category: "Heavy",
      description: "Fixture",
      weight: 3,
      async run() {
        return { score: 1, summary: "complete" };
      },
    },
  ];
  const report = await runSuite({
    tasks,
    python: null,
    env,
    archiveId: "fixture-run",
    contextWindow: 32768,
    chat: async () => ({ choices: [{ message: { content: "fixture response" } }] }),
    onProgress: (event) => progress.push(event),
  });
  expect(report.overall).toBe(0.875);
  expect(report.executedCode).toBe(false);
  expect(progress.map((event) => [event.phase, event.title])).toEqual([
    ["start", "Light"],
    ["done", "Light"],
    ["start", "Heavy"],
    ["done", "Heavy"],
  ]);
  expect(loadArchive("fixture-run", env).light[0]).toMatchObject({
    request: { messages: [{ content: "fixture request" }] },
    response: { choices: [{ message: { content: "fixture response" } }] },
  });
});
it("records a failed task while allowing unrelated tasks to finish", async () => {
  const tasks: Task[] = [
    {
      id: "failed",
      category: "Failed",
      description: "Fixture",
      weight: 1,
      async run() {
        throw new Error("fixture failure");
      },
    },
    {
      id: "ok",
      category: "OK",
      description: "Fixture",
      weight: 1,
      async run() {
        return { score: 1, summary: "done" };
      },
    },
  ];
  const report = await runSuite({ tasks, python: null, env: home() });
  expect(report.overall).toBe(0.5);
  expect(report.results[0]).toMatchObject({ score: 0, error: "fixture failure" });
  expect(report.results[1].score).toBe(1);
});
it("cancellation ends the whole suite without executing subsequent tasks", async () => {
  const controller = new AbortController();
  let later = false;
  const tasks: Task[] = [
    {
      id: "cancel",
      category: "Cancel",
      description: "Fixture",
      weight: 1,
      async run(context) {
        await context.chat({ messages: [] });
        return { score: 1, summary: "must not complete" };
      },
    },
    {
      id: "later",
      category: "Later",
      description: "Fixture",
      weight: 1,
      async run() {
        later = true;
        return { score: 1, summary: "must not run" };
      },
    },
  ];
  await expect(
    runSuite({
      tasks,
      python: null,
      env: home(),
      signal: controller.signal,
      chat: async () => {
        controller.abort(new Error("fixture cancelled"));
        return {};
      },
    }),
  ).rejects.toThrow("fixture cancelled");
  expect(later).toBe(false);
});
