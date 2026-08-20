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
});
