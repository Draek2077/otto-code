import { highlightCode } from "@getpaseo/highlight";
import type { EditorVisualTheme } from "@/file-pane/editor/extensions.web";
import { parseHoverMarkdown, plainProse, filenameForHoverLanguage } from "./hover-markdown";
/** Recovered signature/prose separation. Build text nodes, never innerHTML. */
export function renderEditorHover(markdown: string, filename: string, theme: EditorVisualTheme) {
  const root = document.createElement("div");
  root.className = "otto-code-hover";
  for (const segment of parseHoverMarkdown(markdown)) {
    const node = document.createElement(segment.kind === "code" ? "pre" : "div");
    node.className = `otto-code-hover-${segment.kind}`;
    if (segment.kind === "prose") node.textContent = plainProse(segment.text);
    else
      appendHighlighted(
        node,
        segment.text,
        filenameForHoverLanguage(segment.language) ?? filename,
        theme,
      );
    root.append(node);
  }
  return root;
}

function appendHighlighted(
  node: HTMLElement,
  code: string,
  filename: string,
  theme: EditorVisualTheme,
) {
  for (const [index, tokens] of highlightCode(code, filename).entries()) {
    if (index) node.append(document.createTextNode("\n"));
    for (const token of tokens) {
      const span = document.createElement("span");
      span.textContent = token.text;
      if (token.style) span.style.color = theme.syntax[token.style];
      node.append(span);
    }
  }
}
