import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { put, runId } from "../ops/archive.js";
import { TOOL_CASES } from "./tasks.js";
import { rescoreAll, rescoreRun } from "./rescore.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-rescore-"));
  roots.push(root);
  return { root, env: { OTTO_HOME: root }, id: runId(null) };
}

it("regrades archived tool behavior in the selected host without contacting a model", async () => {
  const { id, env } = fixture();
  put(
    id,
    "tool-calling",
    {
      request: { messages: [{ role: "user", content: TOOL_CASES[0].prompt }] },
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
    },
    env,
  );
  put(id, "depth-scaling", { request: {}, response: {} }, env);
  const report = await rescoreRun(id, { env, python: null, execute: false });
  expect(report.tasks.find((task) => task.taskId === "tool-calling")).toMatchObject({
    score: 1,
    summary: "1/1 tool calls correct",
  });
  expect(report.tasks.find((task) => task.taskId === "depth-scaling")).toMatchObject({
    skipped: true,
    score: null,
  });
  expect(
    await rescoreAll({
      env: { OTTO_HOME: path.join(env.OTTO_HOME, "another-host") },
      python: null,
    }),
  ).toEqual([]);
});

it("handles malformed archived payloads and honors explicit interpreter disablement", async () => {
  const { id, env, root } = fixture();
  put(id, "tool-calling", { request: { messages: "wrong shape" }, response: null }, env);
  put(
    id,
    "long-horizon",
    {
      request: {},
      response: { choices: [{ message: { content: "```python lru.py\nx = 1\n```" } }] },
    },
    env,
  );
  const report = await rescoreRun(id, {
    env,
    python: null,
    execute: false,
    temporaryDirectory: root,
  });
  expect(report.tasks.find((task) => task.taskId === "tool-calling")).toMatchObject({
    score: null,
    summary: "no matching cases in archive",
  });
  expect(report.tasks.find((task) => task.taskId === "long-horizon")?.summary).toContain(
    "tests not executed",
  );
});

it("stops replay between runs after cancellation", async () => {
  const { id, env } = fixture();
  put(id, "depth-scaling", { request: {}, response: {} }, env);
  const controller = new AbortController();
  controller.abort(new Error("rescore cancelled"));
  await expect(rescoreAll({ env, signal: controller.signal, python: null })).rejects.toThrow(
    "rescore cancelled",
  );
});
