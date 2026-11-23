import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { BrainConnectionSaveSchema } from "@getpaseo/protocol/otto/brain";
import { readBrainInput } from "./input.js";

describe("Brain CLI write documents", () => {
  it("reads an explicit stdin document with its original revision and credential intent", async () => {
    const document = {
      expectedRevision: "origin",
      patch: { enabled: true },
      credential: { action: "keep" },
    };
    expect(
      await readBrainInput(
        "-",
        BrainConnectionSaveSchema,
        Readable.from([JSON.stringify(document)]),
      ),
    ).toEqual(document);
  });
  it.each([
    "not-json-private-key",
    JSON.stringify({
      expectedRevision: "origin",
      patch: {},
      credential: { action: "replace", value: "" },
    }),
    "x".repeat(128 * 1024 + 1),
  ])(
    "rejects malformed, blank replacement and oversized input without reflecting contents",
    async (input) => {
      const failure = await readBrainInput(
        "-",
        BrainConnectionSaveSchema,
        Readable.from([input]),
      ).catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "BRAIN_INPUT_INVALID" });
      expect(String(failure)).not.toContain(input);
    },
  );
});
