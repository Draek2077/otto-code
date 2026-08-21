import { describe, expect, it } from "vitest";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import {
  buildWorkspaceAttachmentScopeKey,
  resetWorkspaceAttachmentsStore,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import { collectAnnotatedHeadingSourceLines } from "@/attachments/rendered-document-annotations";
import { getAttachmentKey, removeWorkspaceAttachmentsMatching } from "./workspace-cleanup";

function headingAnnotation(): WorkspaceComposerAttachment {
  return {
    kind: "rendered_document",
    id: "docs/design.md:heading:12:12",
    path: "docs/design.md",
    locator: { kind: "heading", level: 2, lineStart: 12, lineEnd: 12, text: "Design" },
    excerpt: "## Design",
    comment: "Keep this stable.",
  };
}

describe("workspace attachment cleanup", () => {
  it("removes the preview heading glyph when Composer removes its annotation pill", () => {
    resetWorkspaceAttachmentsStore();
    const scopeKey = buildWorkspaceAttachmentScopeKey({
      serverId: "local",
      workspaceId: "workspace-1",
      cwd: "/repo",
    });
    const attachment = headingAnnotation();
    useWorkspaceAttachmentsStore
      .getState()
      .setWorkspaceAttachments({ scopeKey, attachments: [attachment] });

    expect(
      collectAnnotatedHeadingSourceLines({
        attachments: useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey] ?? [],
        path: "docs/design.md",
      }),
    ).toEqual([12]);

    removeWorkspaceAttachmentsMatching(getAttachmentKey(attachment));

    expect(
      collectAnnotatedHeadingSourceLines({
        attachments: useWorkspaceAttachmentsStore.getState().attachmentsByScope[scopeKey] ?? [],
        path: "docs/design.md",
      }),
    ).toEqual([]);
  });
});
