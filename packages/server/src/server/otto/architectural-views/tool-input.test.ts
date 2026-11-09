import { expect, test } from "vitest";
import { z } from "zod";
import { viewDraftToolInput, viewToolSpecification } from "./tool-input.js";
test("native model schemas remain plain JSON objects without recursive references", () => {
  const schema = z.toJSONSchema(viewDraftToolInput);
  expect(schema.type).toBe("object");
  expect(JSON.stringify(schema)).not.toContain('"$ref"');
  expect(schema.properties?.specification).toMatchObject({ type: "object" });
});
test("the catalog's shallow parse admits no recursive traversal before explicit input preflight", () => {
  const cycle: Record<string, unknown> = {};
  cycle.next = cycle;
  const input = viewDraftToolInput.parse({
    expectedRevision: "a".repeat(64),
    specification: cycle,
  });
  expect(() => viewToolSpecification(input.specification)).toThrow("structural budget");
  expect(() => viewToolSpecification({ brand: "external" })).toThrow("brand artwork");
});
test("known pre-mutation input failures are typed validation rejections with the original cause", () => {
  try {
    viewToolSpecification({ value: () => {} });
    throw new Error("Input should fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "invalid" });
    expect(error).toHaveProperty("cause");
  }
});
