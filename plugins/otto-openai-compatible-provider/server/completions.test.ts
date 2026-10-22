import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { streamCompletion } from "./completions.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

it("assembles streamed text, fragmented tool arguments and final request usage", async () => {
  const requests: unknown[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push(JSON.parse(body));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const events = [
      { choices: [{ index: 0, delta: { content: "Checking café" } }] },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "otto_read_file", arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        choices: [],
        usage: {
          prompt_tokens: 31,
          completion_tokens: 12,
          prompt_tokens_details: { cached_tokens: 7 },
        },
      },
    ];
    const bytes = Buffer.from(
      events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("") +
        "data: [DONE]\r\n\r\n",
    );
    // Split every byte, including the UTF-8 character and SSE delimiters.
    for (const byte of bytes) response.write(Buffer.from([byte]));
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing test endpoint");
  const updates: string[] = [];
  const result = await streamCompletion({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: "local-model",
    messages: [{ role: "user", content: "Read the README" }],
    tools: [],
    signal: AbortSignal.timeout(5000),
    onText: (text) => updates.push(text),
  });
  expect(requests).toEqual([
    {
      model: "local-model",
      messages: [{ role: "user", content: "Read the README" }],
      stream: true,
      stream_options: { include_usage: true },
    },
  ]);
  expect(updates).toEqual(["Checking café"]);
  expect(result).toEqual({
    content: "Checking café",
    reasoning: "",
    toolCalls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "otto_read_file", arguments: '{"path":"README.md"}' },
      },
    ],
    usage: { inputTokens: 31, outputTokens: 12, cachedInputTokens: 7 },
  });
});
