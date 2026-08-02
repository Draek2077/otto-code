import { describe, expect, it } from "vitest";
import {
  insertHorizontalRule,
  insertImage,
  insertLink,
  insertTable,
  selectedLineSpan,
  toggleBlockquote,
  toggleCode,
  toggleCodeFence,
  toggleHeading,
  toggleInlineMarker,
  toggleList,
  toggleTaskChecked,
  type DocRange,
  type MarkdownEdit,
} from "./markdown-format";

/** Apply an edit and render the selection as «…» so assertions read as text. */
function apply(doc: string, edit: MarkdownEdit | null): string {
  if (!edit) return doc;
  const next = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
  const { from, to } = edit.selection;
  return `${next.slice(0, from)}«${next.slice(from, to)}»${next.slice(to)}`;
}

/** Build a range from a doc written with | as caret or «» as selection. */
function at(doc: string, from: number, to = from): DocRange {
  return { from, to };
}

describe("toggleInlineMarker", () => {
  it("wraps the selection and keeps the original text selected", () => {
    const doc = "make this bold";
    expect(apply(doc, toggleInlineMarker(doc, at(doc, 10, 14), "**"))).toBe("make this **«bold»**");
  });

  it("round-trips: a second toggle removes what the first added", () => {
    const doc = "make this bold";
    const first = toggleInlineMarker(doc, at(doc, 10, 14), "**");
    const next = doc.slice(0, first.from) + first.insert + doc.slice(first.to);
    const second = toggleInlineMarker(next, first.selection, "**");
    expect(apply(next, second)).toBe("make this «bold»");
  });

  it("removes markers that sit just outside the selection", () => {
    const doc = "a **word** b";
    expect(apply(doc, toggleInlineMarker(doc, at(doc, 4, 8), "**"))).toBe("a «word» b");
  });

  it("removes markers the selection contains whole", () => {
    const doc = "a **word** b";
    expect(apply(doc, toggleInlineMarker(doc, at(doc, 2, 10), "**"))).toBe("a «word» b");
  });

  it("puts the caret between the markers for an empty selection", () => {
    const doc = "ab";
    expect(apply(doc, toggleInlineMarker(doc, at(doc, 1), "**"))).toBe("a**«»**b");
  });

  // The reason hasMarkerBefore rejects a longer run.
  it("does not mistake the inner star of bold for an italic marker", () => {
    const doc = "a **word** b";
    expect(apply(doc, toggleInlineMarker(doc, at(doc, 4, 8), "*"))).toBe("a ***«word»*** b");
  });

  it("handles strikethrough and inline code with the same rules", () => {
    const doc = "gone";
    expect(apply(doc, toggleInlineMarker(doc, at(doc, 0, 4), "~~"))).toBe("~~«gone»~~");
    expect(apply(doc, toggleInlineMarker(doc, at(doc, 0, 4), "`"))).toBe("`«gone»`");
  });
});

describe("selectedLineSpan", () => {
  it("does not drag in a line the selection only touches the start of", () => {
    const doc = "one\ntwo\nthree";
    // Selects all of "one" plus the newline, landing at the head of "two".
    const span = selectedLineSpan(doc, at(doc, 0, 4));
    expect(doc.slice(span.from, span.to)).toBe("one");
  });

  it("covers every line the selection genuinely touches", () => {
    const doc = "one\ntwo\nthree";
    const span = selectedLineSpan(doc, at(doc, 1, 9));
    expect(doc.slice(span.from, span.to)).toBe("one\ntwo\nthree");
  });
});

describe("toggleHeading", () => {
  it("adds a heading marker at the requested level", () => {
    const doc = "Title";
    expect(apply(doc, toggleHeading(doc, at(doc, 0), 2))).toBe("«## Title»");
  });

  it("removes the marker when the line is already at that level", () => {
    const doc = "## Title";
    expect(apply(doc, toggleHeading(doc, at(doc, 0), 2))).toBe("«Title»");
  });

  it("changes level rather than stacking markers", () => {
    const doc = "## Title";
    expect(apply(doc, toggleHeading(doc, at(doc, 0), 4))).toBe("«#### Title»");
  });

  it("replaces a list marker instead of nesting inside it", () => {
    const doc = "- Item";
    expect(apply(doc, toggleHeading(doc, at(doc, 0), 1))).toBe("«# Item»");
  });

  it("leaves blank lines alone", () => {
    const doc = "one\n\ntwo";
    expect(apply(doc, toggleHeading(doc, at(doc, 0, 8), 3))).toBe("«### one\n\n### two»");
  });
});

describe("toggleBlockquote", () => {
  it("quotes every selected line", () => {
    const doc = "one\ntwo";
    expect(apply(doc, toggleBlockquote(doc, at(doc, 0, 7)))).toBe("«> one\n> two»");
  });

  it("unquotes when every line is already quoted", () => {
    const doc = "> one\n> two";
    expect(apply(doc, toggleBlockquote(doc, at(doc, 0, 11)))).toBe("«one\ntwo»");
  });
});

describe("toggleList", () => {
  it("bullets the selected lines", () => {
    const doc = "one\ntwo";
    expect(apply(doc, toggleList(doc, at(doc, 0, 7), "bullet"))).toBe("«- one\n- two»");
  });

  it("numbers an ordered list across the selection instead of repeating 1.", () => {
    const doc = "one\ntwo\nthree";
    expect(apply(doc, toggleList(doc, at(doc, 0, 13), "ordered"))).toBe(
      "«1. one\n2. two\n3. three»",
    );
  });

  it("removes the marker when every line already has it", () => {
    const doc = "- one\n- two";
    expect(apply(doc, toggleList(doc, at(doc, 0, 11), "bullet"))).toBe("«one\ntwo»");
  });

  it("converts a bullet list to a task list rather than doubling the marker", () => {
    const doc = "- one\n- two";
    expect(apply(doc, toggleList(doc, at(doc, 0, 11), "task"))).toBe("«- [ ] one\n- [ ] two»");
  });

  // A task item is a bullet too; asking for "bullet" must not read it as one.
  it("converts a task list back to plain bullets", () => {
    const doc = "- [ ] one\n- [ ] two";
    expect(apply(doc, toggleList(doc, at(doc, 0, 19), "bullet"))).toBe("«- one\n- two»");
  });

  it("preserves indentation", () => {
    const doc = "  nested";
    expect(apply(doc, toggleList(doc, at(doc, 0, 8), "bullet"))).toBe("«  - nested»");
  });
});

describe("toggleTaskChecked", () => {
  it("checks an unchecked item", () => {
    const doc = "- [ ] task";
    expect(apply(doc, toggleTaskChecked(doc, at(doc, 0)))).toBe("«- [x] task»");
  });

  it("unchecks when every selected item is checked", () => {
    const doc = "- [x] a\n- [x] b";
    expect(apply(doc, toggleTaskChecked(doc, at(doc, 0, 15)))).toBe("«- [ ] a\n- [ ] b»");
  });

  it("returns null when there is no task item to flip", () => {
    expect(toggleTaskChecked("plain line", at("plain line", 0))).toBeNull();
  });
});

describe("code fences", () => {
  it("wraps the selection and parks the caret on the info string", () => {
    const doc = "call()";
    expect(apply(doc, toggleCodeFence(doc, at(doc, 0, 6)))).toBe("```«»\ncall()\n```");
  });

  it("unwraps a fence it already made", () => {
    const doc = "```\ncall()\n```";
    expect(apply(doc, toggleCodeFence(doc, at(doc, 0, 14)))).toBe("«call()»");
  });

  it("picks a fence for a multi-line selection and backticks for one line", () => {
    const single = "call()";
    expect(apply(single, toggleCode(single, at(single, 0, 6)))).toBe("`«call()»`");
    const multi = "a\nb";
    expect(apply(multi, toggleCode(multi, at(multi, 0, 3)))).toBe("```«»\na\nb\n```");
  });
});

describe("links and images", () => {
  it("selects the empty target when prose was selected", () => {
    const doc = "click here";
    expect(apply(doc, insertLink(doc, at(doc, 0, 10)))).toBe("[click here](«»)");
  });

  it("puts the caret in the empty label when a URL was selected", () => {
    const doc = "https://example.com";
    expect(apply(doc, insertLink(doc, at(doc, 0, 19)))).toBe("[«»](https://example.com)");
  });

  it("recognises relative and anchor targets as URLs too", () => {
    const doc = "./docs/readme.md";
    expect(apply(doc, insertLink(doc, at(doc, 0, 16)))).toBe("[«»](./docs/readme.md)");
  });

  it("uses a supplied url and keeps it selected", () => {
    const doc = "label";
    expect(apply(doc, insertLink(doc, at(doc, 0, 5), "http://x"))).toBe("[label](«http://x»)");
  });

  it("writes an image as a link with a bang", () => {
    const doc = "alt";
    expect(apply(doc, insertImage(doc, at(doc, 0, 3), "a.png"))).toBe("![alt](«a.png»)");
  });
});

describe("blocks", () => {
  // Without the blank line the preceding text becomes a Setext heading.
  it("separates a horizontal rule from the paragraph above it", () => {
    const doc = "text";
    expect(apply(doc, insertHorizontalRule(doc, at(doc, 4)))).toBe("text\n\n---\n«»");
  });

  it("does not add separation on an already blank line", () => {
    const doc = "";
    expect(apply(doc, insertHorizontalRule(doc, at(doc, 0)))).toBe("---\n«»");
  });

  it("builds a GFM table with the first header cell selected", () => {
    const doc = "";
    expect(apply(doc, insertTable(doc, at(doc, 0), 1, 2))).toBe(
      "| «Column 1» | Column 2 |\n| --- | --- |\n|   |   |\n",
    );
  });

  it("pushes a table off the current line when there is text on it", () => {
    const doc = "prose";
    const result = apply(doc, insertTable(doc, at(doc, 5), 1, 1));
    expect(result.startsWith("prose\n\n| «Column 1» |")).toBe(true);
  });
});
