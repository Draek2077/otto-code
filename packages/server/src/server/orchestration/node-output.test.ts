import { describe, expect, test } from "vitest";

import {
  NodeOutputStore,
  buildOutputInstruction,
  compileOutputToolInputShape,
  extractOutputFieldsFromProse,
  validateNodeOutput,
} from "./node-output.js";

const FIELDS = [
  { key: "complexity", type: "string", description: "simple or complex" },
  { key: "score", type: "number" },
  { key: "notes", type: "string", required: false },
];

describe("validateNodeOutput", () => {
  test("accepts a submission that matches the declared fields", () => {
    const result = validateNodeOutput(FIELDS, { complexity: "simple", score: 0.9 });
    expect(result).toEqual({ ok: true, value: { complexity: "simple", score: 0.9 } });
  });

  test("names the missing field so the model can correct it", () => {
    const result = validateNodeOutput(FIELDS, { complexity: "simple" });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("score");
  });

  test("a field declared optional may be absent", () => {
    expect(validateNodeOutput(FIELDS, { complexity: "simple", score: 1 }).ok).toBe(true);
  });

  test("an unknown type accepts any value rather than rejecting the graph", () => {
    // `type` is an open wire vocabulary: an old daemon meeting a new type must
    // degrade to accepting, never to failing a run it could have executed.
    const result = validateNodeOutput([{ key: "shape", type: "polygon" }], { shape: { sides: 3 } });
    expect(result.ok).toBe(true);
  });
});

describe("compileOutputToolInputShape", () => {
  test("advertises every field but parses permissively", () => {
    // Requiredness is enforced by validateNodeOutput, not by the parse: a
    // missing field has to reach the handler to come back as a correctable
    // tool error rather than a thrown parse failure.
    const shape = compileOutputToolInputShape(FIELDS);
    expect(Object.keys(shape)).toEqual(["complexity", "score", "notes"]);
    for (const field of Object.values(shape)) {
      expect(field.safeParse(undefined).success).toBe(true);
    }
  });
});

describe("buildOutputInstruction", () => {
  test("lists the contract and marks which fields are optional", () => {
    const instruction = buildOutputInstruction(FIELDS);
    expect(instruction).toContain("submit_output");
    expect(instruction).toContain("- complexity (string) — simple or complex");
    expect(instruction).toContain("- notes (string, optional)");
  });
});

describe("extractOutputFieldsFromProse", () => {
  test("recovers a valid object written as prose instead of a tool call", () => {
    const message = `Here is my answer:\n\n\`\`\`json\n{"complexity":"complex","score":0.4}\n\`\`\`\nDone.`;
    expect(extractOutputFieldsFromProse(FIELDS, message)).toEqual({
      complexity: "complex",
      score: 0.4,
    });
  });

  test("skips objects that do not satisfy the contract", () => {
    const message = `First {"unrelated":true} then {"complexity":"simple","score":2}`;
    expect(extractOutputFieldsFromProse(FIELDS, message)).toEqual({
      complexity: "simple",
      score: 2,
    });
  });

  test("returns null when nothing in the message matches", () => {
    expect(extractOutputFieldsFromProse(FIELDS, "I could not do it.")).toBeNull();
    expect(extractOutputFieldsFromProse(FIELDS, null)).toBeNull();
  });
});

describe("NodeOutputStore", () => {
  test("a submission is taken exactly once", () => {
    const store = new NodeOutputStore();
    store.record("agent-1", { complexity: "simple", score: 1 });
    expect(store.take("agent-1")).toEqual({ complexity: "simple", score: 1 });
    // Taken, not read: a later iteration of the same node must not inherit it.
    expect(store.take("agent-1")).toBeNull();
  });

  test("a corrected submission replaces the earlier one", () => {
    const store = new NodeOutputStore();
    store.record("agent-1", { score: 1 });
    store.record("agent-1", { score: 2 });
    expect(store.take("agent-1")).toEqual({ score: 2 });
  });
});
