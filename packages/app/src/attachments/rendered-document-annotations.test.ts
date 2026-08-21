import { describe, expect, it } from "vitest";
import type { WorkspaceComposerAttachment } from "./types";
import {
  collectAnnotatedHeadingComments,
  collectAnnotatedHeadingSourceLines,
} from "./rendered-document-annotations";

function headingAnnotation(path: string, lineStart: number): WorkspaceComposerAttachment {
  return {
    kind: "rendered_document",
    id: `${path}:heading:${lineStart}:${lineStart}`,
    path,
    locator: { kind: "heading", level: 2, lineStart, lineEnd: lineStart, text: "Design" },
    excerpt: "## Design",
    comment: "Keep this stable.",
  };
}

describe("collectAnnotatedHeadingSourceLines", () => {
  it("removes a preview glyph when its Composer attachment is removed", () => {
    const attachment = headingAnnotation("docs/design.md", 12);

    expect(
      collectAnnotatedHeadingSourceLines({ attachments: [attachment], path: "docs/design.md" }),
    ).toEqual([12]);
    expect(collectAnnotatedHeadingSourceLines({ attachments: [], path: "docs/design.md" })).toEqual(
      [],
    );
  });

  it("retains the saved note when reopening a heading annotation", () => {
    const attachment = headingAnnotation("docs/design.md", 12);

    expect(
      collectAnnotatedHeadingComments({ attachments: [attachment], path: "docs/design.md" }),
    ).toEqual(new Map([[12, "Keep this stable."]]));
  });
});
