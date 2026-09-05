// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { resolveSyntaxColors } from "@otto-code/highlight";
import { FileSourceView } from "./view.web";
import type { EditorVisualTheme } from "../editor/extensions.web";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { SourceFindMatch } from "./types";

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
const FILE_LOCATION = { path: "fixture.ts" };

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ host: HTMLElement; root: Root }> = [];

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    act(() => entry?.root.unmount());
    entry?.host.remove();
  }
});

function mount(input: {
  content: string;
  filename?: string;
  size?: number;
  location?: WorkspaceFileLocation;
  navigationRevision?: number;
  findMatches?: readonly SourceFindMatch[];
  wrapLines?: boolean;
}): { host: HTMLElement; root: Root } {
  const host = document.createElement("div");
  host.style.height = "300px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const render = (props: typeof input) => {
    const location = props.location ?? FILE_LOCATION;
    act(() => {
      root.render(
        <FileSourceView
          content={props.content}
          filename={props.filename ?? "fixture.ts"}
          location={location}
          navigationRevision={props.navigationRevision ?? 0}
          size={props.size ?? props.content.length}
          theme={THEME}
          tooLargeMessage="Too large"
          findMatches={props.findMatches}
          wrapLines={props.wrapLines}
        />,
      );
    });
  };
  render(input);
  const entry = { host, root };
  mounted.push(entry);
  return entry;
}

describe("FileSourceView (web)", () => {
  it("uses CodeMirror's virtualized document for a multi-megabyte source file", () => {
    const line = "export const value = 1234567890;\n";
    const content = line.repeat(Math.ceil((2 * 1024 * 1024) / line.length));
    const { host } = mount({ content });

    expect(host.querySelector('[data-testid="file-source-editor"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="file-source-highlight-disabled"]')).toBeNull();
    expect(host.querySelector(".cm-content")?.textContent).toContain("export const value");
    expect(host.querySelector(".cm-content")?.textContent?.length).toBeLessThan(content.length);
    expect(host.querySelectorAll(".cm-line").length).toBeLessThan(content.split("\n").length);
  });

  it("explains the plain source presentation without changing its content", () => {
    const { host } = mount({ content: "plain source", size: 10 * 1024 * 1024 + 1 });

    expect(host.querySelectorAll('[data-testid="file-source-highlight-disabled"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="file-source-editor"]')).not.toBeNull();
    expect(host.querySelector(".cm-content")?.textContent).toBe("plain source");
    expect(host.querySelector('[data-testid="file-source-too-large"]')).toBeNull();
  });

  it("keeps the requested line range visible as a source-level highlight", () => {
    const { host } = mount({
      content: "one\ntwo\nthree\nfour\nfive",
      location: { ...FILE_LOCATION, lineStart: 2, lineEnd: 4 },
    });

    expect(host.querySelectorAll(".cm-file-source-line-highlight")).toHaveLength(3);
  });

  it("uses the Otto extension seam for find marks and soft wrapping", () => {
    const { host } = mount({
      content: "needle\nneedle",
      findMatches: [
        { line: 1, start: 0, end: 6, active: false },
        { line: 2, start: 0, end: 6, active: true },
      ],
      wrapLines: true,
    });

    expect(host.querySelectorAll(".cm-file-source-find-match")).toHaveLength(2);
    expect(host.querySelectorAll(".cm-file-source-find-active")).toHaveLength(1);
    expect(host.querySelector(".cm-content")?.className).toContain("cm-lineWrapping");
  });

  it("renders a very long plain-text line without falling back to the full-file renderer", () => {
    const content = "x".repeat(512 * 1024);
    const { host } = mount({
      content,
      filename: "fixture.txt",
      location: { path: "fixture.txt" },
    });

    expect(host.querySelector('[data-testid="file-source-editor"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="file-source-too-large"]')).toBeNull();
    expect(host.querySelectorAll(".cm-line")).toHaveLength(1);
  });

  it("updates frequently changing content in one retained editor instance", () => {
    const { host, root } = mount({ content: "const revision = 1;" });

    act(() => {
      root.render(
        <FileSourceView
          content="const revision = 2;"
          filename="fixture.ts"
          location={FILE_LOCATION}
          navigationRevision={1}
          size={20}
          theme={THEME}
          tooLargeMessage="Too large"
        />,
      );
    });

    expect(host.querySelectorAll(".cm-editor")).toHaveLength(1);
    expect(host.querySelector(".cm-content")?.textContent).toBe("const revision = 2;");
  });

  it("refuses input above the source-view budget", () => {
    const { host } = mount({ content: "ignored", size: 50 * 1024 * 1024 + 1 });

    expect(host.querySelector('[data-testid="file-source-too-large"]')?.textContent).toBe(
      "Too large",
    );
    expect(host.querySelector('[data-testid="file-source-highlight-disabled"]')).toBeNull();
  });
});
