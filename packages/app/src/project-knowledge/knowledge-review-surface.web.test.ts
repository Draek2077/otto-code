// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findSourceAnchorForDomRange } from "./markdown-dom-source-range.web";

describe("Knowledge review source selection", () => {
  it("resolves another selection when its end is an inline element boundary", () => {
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    const first = document.createTextNode("Otto keeps ");
    const emphasis = document.createElement("strong");
    const selected = document.createTextNode("shared project memory");
    const tail = document.createTextNode(" current.");
    emphasis.append(selected);
    paragraph.append(first, emphasis, tail);
    root.append(paragraph);

    const range = document.createRange();
    range.setStart(selected, 0);
    // Dragging out of an inline element commonly reports the parent boundary,
    // rather than the text node itself, as the end of the browser range.
    range.setEnd(paragraph, 2);

    const runs = [
      { text: "Otto keeps ", start: 0, end: 11 },
      { text: "shared project memory", start: 13, end: 34 },
      { text: " current.", start: 36, end: 45 },
    ];
    expect(findSourceAnchorForDomRange(root, range, runs)).toEqual({ start: 13, end: 34 });

    // A first note is painted with CSS Highlight, which does not mutate the
    // source DOM. The next selection must resolve to its own source span.
    const second = document.createRange();
    second.setStart(first, 0);
    second.setEnd(selected, 6);
    expect(findSourceAnchorForDomRange(root, second, runs)).toEqual({ start: 0, end: 19 });
  });

  it("resynchronizes after renderer-only text so later annotations remain selectable", () => {
    const root = document.createElement("div");
    const paragraph = document.createElement("p");
    const first = document.createTextNode("First editable passage.");
    const rendererOnly = document.createTextNode("Rendered label");
    const later = document.createTextNode("A later editable passage.");
    paragraph.append(first, rendererOnly, later);
    root.append(paragraph);

    const range = document.createRange();
    range.setStart(later, 2);
    range.setEnd(later, 17);
    const runs = [
      { text: "First editable passage.", start: 0, end: 23 },
      // Markdown may render this construct into a different DOM shape.
      { text: "Raw Markdown construct", start: 25, end: 47 },
      { text: "A later editable passage.", start: 49, end: 74 },
    ];

    expect(findSourceAnchorForDomRange(root, range, runs)).toEqual({ start: 51, end: 66 });
  });
});
