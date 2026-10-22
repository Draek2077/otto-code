import { afterEach, expect, it, vi } from "vitest";
import { streamCompletion } from "./completions.js";
import { OpenAiSession } from "./session.js";

afterEach(() => vi.unstubAllGlobals());

it.each([undefined, "length", "content_filter"])(
  "rejects a partial tool stream ending with %s",
  async (finish) => {
    const chunk = {
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "write",
                type: "function",
                function: { name: "otto_write_file", arguments: '{"path":' },
              },
            ],
          },
          ...(finish ? { finish_reason: finish } : {}),
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    await expect(
      streamCompletion({
        baseUrl: "http://fixture.invalid/v1",
        model: "fixture",
        messages: [],
        tools: [],
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toThrow(/before the model finished|no incomplete tools were executed/);
  },
);

it("refuses to resume another endpoint's history without mutating saved data", () => {
  const persistence = {
    version: 1,
    data: {
      format: "otto-openai-compatible-v1",
      endpoint: "http://first.invalid/v1/chat/completions",
      messages: [{ role: "user", content: "Private project history" }],
      timeline: [],
    },
  };
  const original = structuredClone(persistence);
  expect(
    () =>
      new OpenAiSession(
        "one",
        {
          cwd: process.cwd(),
          env: {},
          model: "fixture",
          settings: {},
          mcpServers: {},
          persist: true,
        },
        {
          baseUrl: "http://second.invalid/v1",
          model: "fixture",
          apiKeyEnv: "OPENAI_API_KEY",
          maxToolRounds: 4,
          timeoutMs: 5000,
        },
        () => {},
        persistence,
      ),
  ).toThrow("different endpoint");
  expect(persistence).toEqual(original);
});
