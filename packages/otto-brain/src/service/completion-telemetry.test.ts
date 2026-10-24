import { expect, test } from "vitest";
import { CompletionEvidence, CompletionTelemetry } from "./completion-telemetry.js";

function sse(value: unknown) {
  return `data: ${JSON.stringify(value)}\n\n`;
}
test("records split UTF-8 streaming evidence and treats tool-only replies as usable content", () => {
  const text = Buffer.from(
    sse({ choices: [{ delta: { content: "🙂" } }] }) +
      sse({ choices: [{ finish_reason: "stop", delta: {} }] }) +
      "data: [DONE]\n\n",
  );
  const evidence = new CompletionEvidence(true);
  for (const byte of text) evidence.observe(Buffer.from([byte]));
  expect(evidence.finish(false)).toBe("ok");
  const tool = new CompletionEvidence(true);
  tool.observe(
    Buffer.from(
      sse({
        choices: [{ delta: { reasoning_content: "private thought", tool_calls: [{ index: 0 }] } }],
      }),
    ),
  );
  expect(tool.finish(false)).toBe("ok");
});
test("distinguishes reasoning-only and token truncation in buffered and streamed dialects", () => {
  const reasoning = new CompletionEvidence(false);
  reasoning.observe(
    Buffer.from(
      JSON.stringify({
        choices: [
          {
            message: { content: "", reasoning_content: "private thought" },
            finish_reason: "length",
          },
        ],
      }),
    ),
  );
  expect(reasoning.finish(false)).toBe("reasoning-only");
  const truncated = new CompletionEvidence(true);
  truncated.observe(
    Buffer.from(
      sse({ type: "content_block_delta", delta: { type: "text_delta", text: "visible" } }) +
        sse({ type: "message_delta", delta: { stop_reason: "max_tokens" } }),
    ),
  );
  expect(truncated.finish(false)).toBe("truncated");
  expect(truncated.finish(true)).toBe("failed");
});
test("bounds malformed and oversized capture without inventing a reasoning verdict", () => {
  for (const text of ["not-json", "x".repeat(1024 * 1024 + 1)]) {
    const evidence = new CompletionEvidence(false);
    evidence.observe(Buffer.from(text));
    expect(evidence.finish(false)).toBe("ok");
  }
});
test("warning windows are bounded, model resets preserve lifetime totals, and no completion text is retained", () => {
  const telemetry = new CompletionTelemetry();
  for (let index = 0; index < 3; index++) telemetry.record("model-a", "reasoning-only");
  expect(telemetry.snapshot()).toMatchObject({
    requests: 3,
    reasoningOnly: 3,
    warning: expect.stringContaining("3/3"),
  });
  telemetry.record("model-b", "ok");
  telemetry.resetModel("model-a");
  expect(telemetry.snapshot()).toMatchObject({
    requests: 4,
    ok: 1,
    reasoningOnly: 3,
    warning: null,
  });
  for (let index = 0; index < 55; index++) telemetry.record("model-b", "truncated");
  expect(telemetry.snapshot().warning).toContain("50/50");
});
