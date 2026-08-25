import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveSyntaxColors } from "@otto-code/highlight";
import { FileEditorModel } from "./model";
import { FileEditorView } from "./view";
import type { EditorVisualTheme } from "./extensions.web";

const THEME: EditorVisualTheme = {
  colorScheme: "dark",
  background: "#101014",
  foreground: "#e6e6e6",
  cursor: "#e6e6e6",
  foregroundMuted: "#6b6b76",
  border: "#26262e",
  selection: "#2b3a55",
  monoFont: "monospace",
  codeFontSize: 13,
  syntax: resolveSyntaxColors("default", "dark"),
};
const LOCATION = { path: "example.ts" };
const noop = () => {};

const mounted: Array<{ root: Root; host: HTMLElement; model: FileEditorModel }> = [];

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    act(() => entry?.root.unmount());
    entry?.model.dispose();
    entry?.host.remove();
  }
});

function mount(): HTMLElement {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  const model = new FileEditorModel({
    file: {
      content: "const focused = true;\n",
      hasBom: false,
      version: {
        status: "ready",
        cwd: "/workspace",
        path: "example.ts",
        size: 22,
        modifiedAt: "2026-08-25T00:00:00.000Z",
      },
    },
    session: {
      write: async () => ({
        status: "written" as const,
        size: 22,
        modifiedAt: "2026-08-25T00:00:00.000Z",
      }),
    },
  });
  const root = createRoot(host);
  act(() => {
    root.render(
      <FileEditorView
        model={model}
        filename="example.ts"
        location={LOCATION}
        navigationRevision={0}
        vimEnabled={false}
        theme={THEME}
        onCursorChange={noop}
        onVimModeChange={noop}
      />,
    );
  });
  mounted.push({ root, host, model });
  return host;
}

describe("FileEditorView", () => {
  it("focuses the document when source editing opens", () => {
    const host = mount();

    expect(document.activeElement).toBe(host.querySelector(".cm-content"));
  });
});
