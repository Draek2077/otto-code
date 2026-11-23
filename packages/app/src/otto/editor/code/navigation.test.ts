import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { editorLocationSelection } from "./navigation";
describe("source navigation", () => {
  it("selects exact UTF-16 symbol ranges and clamps stale positions after external edits", () => {
    const doc = EditorState.create({ doc: "😀value\nnext" }).doc;
    expect(editorLocationSelection(doc, { lineStart: 1, columnStart: 3, columnEnd: 8 })).toEqual({
      anchor: 2,
      head: 7,
    });
    expect(editorLocationSelection(doc, { lineStart: 90, columnStart: 90, columnEnd: 95 })).toEqual(
      { anchor: 12, head: 12 },
    );
    expect(editorLocationSelection(doc, { lineStart: 1, lineEnd: 2 })).toEqual({
      anchor: 0,
      head: 12,
    });
  });
});
