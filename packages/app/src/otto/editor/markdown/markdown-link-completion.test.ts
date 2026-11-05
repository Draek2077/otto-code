import { describe, expect, it } from "vitest";
import {
  encodeLinkPath,
  findLinkCompletionContext,
  headingAnchorSlug,
  headingAnchors,
  relativeLinkPath,
} from "./markdown-link-completion";

/** Find the context with the caret at the end of `doc`. */
function atEnd(doc: string) {
  return findLinkCompletionContext(doc, doc.length);
}

describe("findLinkCompletionContext", () => {
  it("opens on an empty target the moment the paren is typed", () => {
    expect(atEnd("see [the docs](")).toEqual({
      kind: "file",
      from: 15,
      query: "",
      file: "",
    });
  });

  it("reads what has been typed so far as the query", () => {
    expect(atEnd("see [the docs](docs/pre")?.query).toBe("docs/pre");
  });

  it("treats an image target the same as a link target", () => {
    expect(atEnd("![a diagram](assets/di")?.kind).toBe("file");
  });

  // The link is finished; the caret is back in prose.
  it("declines once the target has been closed", () => {
    expect(atEnd("see [the docs](docs/a.md)")).toBeNull();
  });

  // A target cannot hold an unescaped space, so this is a sentence.
  it("declines when the text after the paren contains whitespace", () => {
    expect(atEnd("the array](a b")).toBeNull();
  });

  it("declines in ordinary prose", () => {
    expect(atEnd("nothing to complete here")).toBeNull();
  });

  // Scanning is per line, so a link finished on an earlier line is invisible.
  it("does not reach back past the start of the line", () => {
    expect(atEnd("[a](b.md)\nplain prose")).toBeNull();
  });

  it("switches to anchors after a hash, targeting this document", () => {
    expect(atEnd("[a](#get")).toEqual({
      kind: "anchor",
      from: 5,
      query: "get",
      file: "",
    });
  });

  it("records the file when the anchor belongs to another document", () => {
    expect(atEnd("[a](other.md#get")).toEqual({
      kind: "anchor",
      from: 13,
      query: "get",
      file: "other.md",
    });
  });
});

describe("headingAnchorSlug", () => {
  it("lowercases and hyphenates", () => {
    expect(headingAnchorSlug("Getting Started")).toBe("getting-started");
  });

  // The anchor is built from the rendered heading, not the source.
  it("drops inline markup", () => {
    expect(headingAnchorSlug("**Setup** and `config`")).toBe("setup-and-config");
  });

  it("collapses a link to its text", () => {
    expect(headingAnchorSlug("See [the docs](docs/a.md)")).toBe("see-the-docs");
  });

  it("drops punctuation but keeps the words around it", () => {
    expect(headingAnchorSlug("What's new?")).toBe("whats-new");
    expect(headingAnchorSlug("C# and F#")).toBe("c-and-f");
  });

  // \w would slug this to the empty string and every anchor would collide.
  it("keeps non-latin letters", () => {
    expect(headingAnchorSlug("Ελληνικά")).toBe("ελληνικά");
  });
});

describe("headingAnchors", () => {
  it("suffixes repeats in document order, as GitHub does", () => {
    const anchors = headingAnchors([
      { level: 2, text: "Options", line: 1, from: 0 },
      { level: 2, text: "Notes", line: 3, from: 10 },
      { level: 2, text: "Options", line: 5, from: 20 },
      { level: 2, text: "Options", line: 7, from: 30 },
    ]);
    expect(anchors.map((anchor) => anchor.anchor)).toEqual([
      "options",
      "notes",
      "options-1",
      "options-2",
    ]);
  });
});

describe("relativeLinkPath", () => {
  it("drops the shared directory for a sibling", () => {
    expect(relativeLinkPath("docs/a.md", "docs/b.md")).toBe("b.md");
  });

  it("climbs out of the directory when the target is above it", () => {
    expect(relativeLinkPath("docs/a.md", "README.md")).toBe("../README.md");
  });

  it("descends without a prefix from the root", () => {
    expect(relativeLinkPath("README.md", "docs/b.md")).toBe("docs/b.md");
  });

  it("climbs and descends across sibling trees", () => {
    expect(relativeLinkPath("docs/guides/a.md", "packages/app/README.md")).toBe(
      "../../packages/app/README.md",
    );
  });

  it("keeps a deeper path under the current directory", () => {
    expect(relativeLinkPath("docs/a.md", "docs/deep/b.md")).toBe("deep/b.md");
  });
});

describe("encodeLinkPath", () => {
  it("escapes what would end the target early", () => {
    expect(encodeLinkPath("docs/my file (draft).md")).toBe("docs/my%20file%20%28draft%29.md");
  });

  // encodeURI would mangle this for no benefit.
  it("leaves non-ascii alone", () => {
    expect(encodeLinkPath("docs/guía.md")).toBe("docs/guía.md");
  });
});
