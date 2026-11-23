import { describe, expect, it } from "vitest";
import { editorStatusLayout } from "./status-layout";
describe("editor status geometry", () => {
  it("keeps critical diagnostics in an unmeasured or narrow desktop split", () => {
    for (const width of [0, 320, 439])
      expect(editorStatusLayout(width)).toEqual({
        fileSize: false,
        lineCount: false,
        eol: false,
        encoding: false,
        selection: false,
        severities: [1, 2],
      });
  });
  it("restores metadata and advisory diagnostics only when there is room", () => {
    expect(editorStatusLayout(440)).toEqual({
      fileSize: true,
      lineCount: true,
      eol: true,
      encoding: false,
      selection: false,
      severities: [1, 2, 3],
    });
    expect(editorStatusLayout(640)).toEqual({
      fileSize: true,
      lineCount: true,
      eol: true,
      encoding: true,
      selection: true,
      severities: [1, 2, 3, 4],
    });
  });
});
