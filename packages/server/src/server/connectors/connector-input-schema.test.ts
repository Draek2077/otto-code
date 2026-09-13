import { expect, test } from "vitest";
import { z } from "zod";
import { connectorInputSchema } from "./connector-input-schema.js";

// Reduced from mondaycom/mcp's create-submission-tool/schema.ts: signature
// reuses the schema already emitted for answers[].file[].
const mondaySubmissionSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question_id: { type: "string" },
          file: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" } },
              required: ["id", "name"],
              additionalProperties: false,
            },
          },
          signature: { $ref: "#/properties/answers/items/properties/file/items" },
        },
        required: ["question_id"],
      },
    },
  },
  required: ["answers"],
};

test.each([
  "http://json-schema.org/draft-07/schema#",
  "https://json-schema.org/draft/2020-12/schema",
])("nested references preserve validation and schema round trips (%s)", ($schema) => {
  const input = { ...mondaySubmissionSchema, $schema };
  const before = structuredClone(input);
  expect(() => z.fromJSONSchema(input)).toThrow("Reference not found");
  const schema = connectorInputSchema(input);
  const valid = { answers: [{ question_id: "signature", signature: { id: "f1", name: "s.png" } }] };
  const invalid = { answers: [{ question_id: "signature", signature: { name: "s.png" } }] };
  expect(schema.parse(valid)).toEqual(valid);
  expect(schema.safeParse(invalid).success).toBe(false);
  const roundTrip = z.fromJSONSchema(z.toJSONSchema(schema));
  expect(roundTrip.parse(valid)).toEqual(valid);
  expect(roundTrip.safeParse(invalid).success).toBe(false);
  expect(input).toEqual(before);
});

test("local pointers decode escaped names, empty keys and array indices", () => {
  const schema = connectorInputSchema({
    type: "object",
    properties: {
      "a/b~c d": { anyOf: [{ type: "string" }, { type: "number" }] },
      "": { type: "boolean" },
      number: { $ref: "#/properties/a~1b~0c%20d/anyOf/1" },
      flag: { $ref: "#/properties/" },
    },
  });
  expect(schema.parse({ number: 2, flag: false })).toEqual({ number: 2, flag: false });
  expect(schema.safeParse({ number: "2" }).success).toBe(false);
  expect(schema.safeParse({ flag: "false" }).success).toBe(false);
});

test("recursive nested references remain finite and validate children", () => {
  const schema = connectorInputSchema({
    type: "object",
    properties: {
      node: {
        type: "object",
        properties: { value: { type: "string" }, child: { $ref: "#/properties/node" } },
        required: ["value"],
      },
    },
  });
  const valid = { node: { value: "parent", child: { value: "child" } } };
  expect(schema.parse(valid)).toEqual(valid);
  expect(schema.safeParse({ node: { value: "parent", child: { value: 2 } } }).success).toBe(false);
  expect(JSON.stringify(z.toJSONSchema(schema)).length).toBeLessThan(1000);
});

test("literal metadata and properties named $ref are not treated as references", () => {
  const literal = { $ref: "#/not-a-schema" };
  const schema = connectorInputSchema({
    type: "object",
    properties: { $ref: { type: "string" }, data: { type: "object", default: literal } },
    examples: [literal],
  });
  expect(schema.parse({ $ref: "literal" })).toEqual({ $ref: "literal", data: literal });
  expect(z.toJSONSchema(schema).examples).toEqual([literal]);
});

test.each(["#/missing", "#/properties/toString", "https://example.com/schema.json"])(
  "unresolved or external references still fail verification (%s)",
  ($ref) => {
    expect(() =>
      connectorInputSchema({ type: "object", properties: { value: { $ref } } }),
    ).toThrow();
  },
);
