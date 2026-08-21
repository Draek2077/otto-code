import { describe, expect, it } from "vitest";
import type { ComposerAttachment, PullRequestContextAttachment } from "./types";
import {
  isWorkspaceAttachment,
  userAttachmentsOnly,
  workspaceAttachmentToSubmitAttachment,
} from "./workspace-attachment-utils";

function contextAttachment(
  overrides: Partial<PullRequestContextAttachment> = {},
): PullRequestContextAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment · octocat",
    subtitle: "Fix flaky build",
    text: "GitHub pull request comment\n\nLooks good.",
    url: "https://github.com/otto-code-ai/otto-code/pull/42#issuecomment-1",
    ...overrides,
  };
}

describe("workspace attachment utilities", () => {
  it("treats pull request context as a workspace attachment", () => {
    expect(isWorkspaceAttachment(contextAttachment())).toBe(true);
  });

  it("strips context attachments from user draft attachments", () => {
    const normalAttachment: ComposerAttachment = {
      kind: "github_issue",
      item: {
        kind: "issue",
        number: 12,
        title: "Bug",
        url: "https://github.com/otto-code-ai/otto-code/issues/12",
        state: "open",
        body: "Bug report",
        labels: [],
        baseRefName: null,
        headRefName: null,
      },
    };

    expect(userAttachmentsOnly([normalAttachment, contextAttachment()])).toEqual([
      normalAttachment,
    ]);
  });

  it("serializes context attachments as protocol text attachments", () => {
    expect(workspaceAttachmentToSubmitAttachment(contextAttachment())).toEqual({
      type: "text",
      mimeType: "text/plain",
      title: "Comment · octocat",
      text: "GitHub pull request comment\n\nLooks good.",
    });
  });

  // The selection rides as a REFERENCE - path plus range, no excerpt. Pasting
  // the selected text would cost the range in tokens and go stale the moment the
  // agent edits the file, so the prompt points at what to read instead.
  it("sends an attached selection as a row:column range, not as the selected text", () => {
    const attachment: ComposerAttachment = {
      kind: "file_context",
      id: "src/app.ts:12:5-40:18",
      path: "src/app.ts",
      selection: { startLine: 12, startColumn: 5, endLine: 40, endColumn: 18 },
    };
    expect(workspaceAttachmentToSubmitAttachment(attachment)).toEqual({
      type: "text",
      mimeType: "text/plain",
      title: "File · src/app.ts:12:5-40:18",
      text: [
        "Workspace file selection attached as context by the user.",
        "Path: src/app.ts",
        "Selection: line 12 column 5 to line 40 column 18",
        "Read this file, focusing on the selected range above, before responding.",
      ].join("\n"),
    });
  });

  it("still sends a whole attached file as a plain path reference", () => {
    const attachment: ComposerAttachment = {
      kind: "file_context",
      id: "src/app.ts",
      path: "src/app.ts",
      entryKind: "file",
    };
    expect(workspaceAttachmentToSubmitAttachment(attachment)).toEqual({
      type: "text",
      mimeType: "text/plain",
      title: "File · src/app.ts",
      text: [
        "Workspace file attached as context by the user.",
        "Path: src/app.ts",
        "Read this file for its current contents before responding.",
      ].join("\n"),
    });
  });

  it("preserves a rendered document annotation's source locator, excerpt, and user note", () => {
    const attachment: ComposerAttachment = {
      kind: "rendered_document",
      id: "docs/design.md:heading:12:13",
      path: "docs/design.md",
      locator: { kind: "heading", level: 2, lineStart: 12, lineEnd: 13, text: "Tokens" },
      excerpt: "## Tokens",
      comment: "This budget is the important constraint.",
    };

    expect(isWorkspaceAttachment(attachment)).toBe(true);
    const serialized = workspaceAttachmentToSubmitAttachment(attachment);
    expect(serialized).toEqual({
      type: "text",
      mimeType: "text/plain",
      title: "Document annotation · docs/design.md:12",
      text: expect.stringContaining("Source locator: heading level 2, lines 12-13"),
    });
    expect(serialized).toMatchObject({ type: "text" });
    if (!serialized || serialized.type !== "text") {
      throw new Error("Expected a text attachment.");
    }
    expect(serialized.text).toContain("This budget is the important constraint.");
  });

  it("serializes source-backed non-heading document locators", () => {
    const attachment: ComposerAttachment = {
      kind: "rendered_document",
      id: "docs/design.md:fence:20:23",
      path: "docs/design.md",
      locator: { kind: "fence", lineStart: 20, lineEnd: 23, language: "ts" },
      excerpt: "```ts\nconst budget = 1;\n```",
      comment: "Keep this API provider-neutral.",
    };

    const serialized = workspaceAttachmentToSubmitAttachment(attachment);
    expect(serialized).toMatchObject({ type: "text" });
    if (!serialized || serialized.type !== "text") {
      throw new Error("Expected a text attachment.");
    }
    expect(serialized.text).toContain("Source locator: fenced code (ts), lines 20-23");
    expect(serialized.text).toContain("Keep this API provider-neutral.");
  });
});
