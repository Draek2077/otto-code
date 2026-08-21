// @vitest-environment jsdom
import "@/test/window-local-storage";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildDraftWorkspaceAttachmentScopeKey,
  buildWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachments,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { resetReviewDraftStore, useReviewDraftStore } from "@/review/store";
import { removeSentWorkspaceAttachments } from "./workspace-cleanup";
import { composerWorkspaceAttachment } from "./workspace";

vi.mock("@/attachments/attachment-pill-content", () => ({
  getWorkspaceAttachmentPillContent: vi.fn(),
}));

vi.mock("@/components/attachment-pill", () => ({
  AttachmentLabel: vi.fn(),
  AttachmentPill: vi.fn(),
}));

function chatHistoryAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "chat_history",
    id: "chat_history:draft-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Chat history",
      text: "Previous chat.",
    },
    source: {
      serverId: "local",
      agentId: "agent-1",
    },
  };
}

function meetingTranscriptAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "meeting_transcript",
    id: "meeting-1",
    title: "Meeting notes",
    content: "Discussed the release.",
    occurredAt: "2026-08-20T12:00:00.000Z",
  };
}

function pullRequestContextAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment",
    text: "Please check this.",
  };
}

function browserElementAttachment(): WorkspaceComposerAttachment {
  return {
    kind: "browser_element",
    attachment: {
      url: "https://example.com",
      selector: "button.primary",
      tag: "button",
      text: "Click me",
      outerHTML: '<button class="primary">Click me</button>',
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 100, height: 40 },
      reactSource: null,
      parentChain: [],
      children: [],
      formatted: "button.primary\nClick me",
    },
  };
}

function reviewAttachment(
  reviewDraftKey: string,
): Extract<WorkspaceComposerAttachment, { kind: "review" }> {
  return {
    kind: "review",
    reviewDraftKey,
    commentCount: 1,
    attachment: {
      type: "review",
      mimeType: "application/otto-review",
      cwd: "/repo",
      mode: "uncommitted",
      baseRef: null,
      comments: [],
    },
  };
}

const discardableWorkspaceAttachments: Array<[string, WorkspaceComposerAttachment]> = [
  ["browser annotation", browserElementAttachment()],
  ["meeting notes", meetingTranscriptAttachment()],
  ["PR feedback", pullRequestContextAttachment()],
  ["chat history", chatHistoryAttachment()],
  [
    "file context",
    { kind: "file_context", id: "src/example.ts:41", path: "src/example.ts", lineStart: 41 },
  ],
  [
    "rendered document annotation",
    {
      kind: "rendered_document",
      id: "docs/design.md:heading:12:12",
      path: "docs/design.md",
      locator: { kind: "heading", level: 2, lineStart: 12, lineEnd: 12, text: "Design" },
      excerpt: "## Design",
      comment: "Keep this stable.",
    },
  ],
];

function useStoredWorkspaceAttachmentBinding(scopeKey: string) {
  const workspaceAttachments = useWorkspaceAttachments(scopeKey);
  return composerWorkspaceAttachment.useBinding({
    normalAttachments: [],
    workspaceAttachments,
  });
}

afterEach(() => {
  cleanup();
  resetReviewDraftStore();
  resetWorkspaceAttachmentsStore();
});

describe("workspace composer attachment cleanup", () => {
  it("clears sent scoped context attachments from their stores", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const chatHistory = chatHistoryAttachment();
    const pullRequestContext = pullRequestContextAttachment();
    const browserElement = browserElementAttachment();
    const review = reviewAttachment("review:sent");
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [chatHistory, pullRequestContext, browserElement, review],
    });

    removeSentWorkspaceAttachments([chatHistory, pullRequestContext, browserElement, review]);

    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
  });

  it("clears a dismissed meeting transcript from its scope", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildDraftWorkspaceAttachmentScopeKey("draft-1");
    const transcript = meetingTranscriptAttachment();
    useWorkspaceAttachmentsStore.getState().setWorkspaceAttachments({
      scopeKey,
      attachments: [transcript],
    });

    removeSentWorkspaceAttachments([transcript]);

    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
  });

  it("deletes review comments when the review attachment is dismissed", () => {
    const reviewDraftKey = "review:local:repo:uncommitted";
    const scopeKey = buildWorkspaceAttachmentScopeKey({
      serverId: "local",
      workspaceId: "workspace-1",
      cwd: "/repo",
    });
    useReviewDraftStore.getState().addComment({
      key: reviewDraftKey,
      comment: {
        filePath: "src/example.ts",
        side: "new",
        lineNumber: 41,
        body: "Please handle this edge case.",
      },
    });
    const review = reviewAttachment(reviewDraftKey);
    useWorkspaceAttachmentsStore
      .getState()
      .setWorkspaceAttachments({ scopeKey, attachments: [review] });
    const { result } = renderHook(() => useStoredWorkspaceAttachmentBinding(scopeKey));

    let didRemove = false;
    act(() => {
      didRemove = result.current.removeAttachment({
        selectedAttachments: result.current.selectedAttachments,
        index: 0,
      });
    });

    expect(didRemove).toBe(true);
    expect(useReviewDraftStore.getState().drafts[reviewDraftKey]).toBeUndefined();
    expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
    expect(result.current.selectedAttachments).toEqual([]);
  });

  it.each(discardableWorkspaceAttachments)(
    "permanently discards %s when its composer attachment is dismissed",
    (_label, attachment) => {
      const scopeKey = buildWorkspaceAttachmentScopeKey({
        serverId: "local",
        workspaceId: "workspace-1",
        cwd: "/repo",
      });
      useWorkspaceAttachmentsStore
        .getState()
        .setWorkspaceAttachments({ scopeKey, attachments: [attachment] });
      const { result } = renderHook(() => useStoredWorkspaceAttachmentBinding(scopeKey));

      let didRemove = false;
      act(() => {
        didRemove = result.current.removeAttachment({
          selectedAttachments: result.current.selectedAttachments,
          index: 0,
        });
      });

      expect(didRemove).toBe(true);
      expect(useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey]).toBeUndefined();
      expect(result.current.selectedAttachments).toEqual([]);
    },
  );
});
