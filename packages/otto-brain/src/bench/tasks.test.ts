import { expect, it } from "vitest";
import { TASKS, type ChatPayload, type Task } from "./tasks.js";
import { ownToolHandler, toolArguments } from "./tool-call.js";

function task(id: string): Task {
  const found = TASKS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing fixture task ${id}`);
  return found;
}

it("preserves the virtual read/write/test loop without inventing execution or throughput", async () => {
  let turns = 0;
  let observed: ChatPayload | undefined;
  const result = await task("agentic-loop").run({
    python: null,
    contextWindow: 2048,
    chat: async (payload) => {
      observed = structuredClone(payload);
      if (turns++ > 0) return { choices: [{ message: { content: "done" } }] };
      return {
        usage: { prompt_tokens: 1024 },
        choices: [
          {
            message: {
              tool_calls: [
                { id: "read", function: { name: "read_file", arguments: '{"path":"scale.py"}' } },
                {
                  id: "write",
                  function: {
                    name: "write_file",
                    arguments: JSON.stringify({
                      path: "scale.py",
                      content: "def normalize(values): return []",
                    }),
                  },
                },
                {
                  id: "test",
                  function: { name: "run_command", arguments: '{"command":"python -m unittest"}' },
                },
              ],
            },
          },
        ],
      };
    },
  });
  expect(result.score).toBe(1);
  expect(result.detail).toMatchObject({
    steps: { read: true, wrote: true, ranTests: true },
    testsExecuted: false,
    contextUtilization: 0.5,
  });
  expect(result.summary).toContain("no tests executed");
  expect(observed?.messages.find((message) => message.tool_call_id === "test")?.content).toBe(
    "tests could not be executed in this environment",
  );
});

it("tool dispatch cannot call inherited object methods from model-provided names", async () => {
  const handlers = { read_file: async () => "fixture" };
  for (const name of ["__proto__", "constructor", "toString", undefined])
    expect(ownToolHandler(handlers, name)).toBeUndefined();
  expect(await ownToolHandler(handlers, "read_file")?.({})).toBe("fixture");
  expect(toolArguments({ function: { arguments: "[1,2]" } })).toEqual({});
  expect(toolArguments({ function: { arguments: "invalid json" } })).toEqual({});
});
