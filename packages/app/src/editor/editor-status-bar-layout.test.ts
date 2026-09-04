import { describe, expect, it } from "vitest";
import { resolveEditorStatusBarLayout } from "./editor-status-bar-layout";

describe("resolveEditorStatusBarLayout", () => {
  it("keeps only editor-critical categories before the bar is measured or on a phone", () => {
    expect(resolveEditorStatusBarLayout(0)).toEqual({
      showFileSize: false,
      showImageDimensions: false,
      showEol: false,
      showEncoding: false,
      showSelection: false,
      diagnosticSeverities: ["error", "warning"],
    });
    expect(resolveEditorStatusBarLayout(439)).toEqual(resolveEditorStatusBarLayout(0));
  });

  it("adds file metadata but still drops advisory detail at intermediate widths", () => {
    expect(resolveEditorStatusBarLayout(440)).toEqual({
      showFileSize: true,
      showImageDimensions: true,
      showEol: true,
      showEncoding: false,
      showSelection: false,
      diagnosticSeverities: ["error", "warning", "info"],
    });
  });

  it("shows every status category only when the container can support it", () => {
    expect(resolveEditorStatusBarLayout(640)).toEqual({
      showFileSize: true,
      showImageDimensions: true,
      showEol: true,
      showEncoding: true,
      showSelection: true,
      diagnosticSeverities: ["error", "warning", "info", "hint"],
    });
  });
});
