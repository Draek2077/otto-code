import { expect, it } from "vitest";
import { visualizerDataPreview } from "./tool-data";
it("keeps arbitrary provider tool input and output visible as JSON", () => {
  expect(visualizerDataPreview({ command: "build", values: [1, true, null] })).toBe(
    '{"command":"build","values":[1,true,null]}',
  );
});
it("bounds strings, arrays and object depth without following cycles", () => {
  const value: { self?: unknown; text: string; list: number[] } = {
    text: "a".repeat(20000),
    list: Array.from({ length: 1000 }, (_, index) => index),
  };
  value.self = value;
  const preview = visualizerDataPreview(value);
  expect(preview.length).toBeLessThanOrEqual(12000);
  expect(preview).toContain("More content in chat");
});
it("makes absent and invalid scalar results explicit", () => {
  expect(visualizerDataPreview(undefined)).toBe("");
  expect(visualizerDataPreview(Number.NaN)).toBe("null");
});
