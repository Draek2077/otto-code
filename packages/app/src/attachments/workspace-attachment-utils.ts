import type {
  ComposerAttachment,
  PullRequestContextAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import type { AgentAttachment } from "@otto-code/protocol/messages";

export function isPullRequestContextAttachment(
  attachment: ComposerAttachment | undefined,
): attachment is PullRequestContextAttachment {
  return (
    attachment?.kind === "github.pull_request_comment" ||
    attachment?.kind === "github.pull_request_review" ||
    attachment?.kind === "github.pull_request_check"
  );
}

export function isWorkspaceAttachment(
  attachment: ComposerAttachment | undefined,
): attachment is WorkspaceComposerAttachment {
  return (
    attachment?.kind === "review" ||
    attachment?.kind === "browser_element" ||
    attachment?.kind === "chat_history" ||
    attachment?.kind === "file_context" ||
    isPullRequestContextAttachment(attachment)
  );
}

export function userAttachmentsOnly(
  attachments: readonly ComposerAttachment[],
): UserComposerAttachment[] {
  return attachments.filter(
    (attachment): attachment is UserComposerAttachment =>
      attachment.kind !== "review" &&
      attachment.kind !== "browser_element" &&
      attachment.kind !== "chat_history" &&
      attachment.kind !== "file_context" &&
      !isPullRequestContextAttachment(attachment),
  );
}

export function workspaceAttachmentToSubmitAttachment(
  attachment: ComposerAttachment,
): AgentAttachment | null {
  if (attachment.kind === "browser_element") {
    return {
      type: "text",
      mimeType: "text/plain",
      title: `Browser element · ${attachment.attachment.tag}`,
      text: attachment.attachment.formatted,
    };
  }
  if (isPullRequestContextAttachment(attachment)) {
    return {
      type: "text",
      mimeType: "text/plain",
      title: attachment.title,
      text: attachment.text,
    };
  }
  if (attachment.kind === "chat_history") {
    return attachment.attachment;
  }
  if (attachment.kind === "file_context") {
    if (attachment.entryKind === "directory") {
      return {
        type: "text",
        mimeType: "text/plain",
        title: `Folder · ${attachment.path}`,
        text: [
          "Workspace folder attached as context by the user.",
          `Path: ${attachment.path}`,
          "List this folder and read the relevant files inside it before responding.",
        ].join("\n"),
      };
    }
    if (attachment.lineStart != null) {
      return {
        type: "text",
        mimeType: "text/plain",
        title: `File · ${attachment.path}:${attachment.lineStart}`,
        text: [
          "Workspace file line attached as context by the user.",
          `Path: ${attachment.path}`,
          `Line: ${attachment.lineStart}`,
          "Read this file, focusing on the line above, before responding.",
        ].join("\n"),
      };
    }
    return {
      type: "text",
      mimeType: "text/plain",
      title: `File · ${attachment.path}`,
      text: [
        "Workspace file attached as context by the user.",
        `Path: ${attachment.path}`,
        "Read this file for its current contents before responding.",
      ].join("\n"),
    };
  }
  return attachment.kind === "review" ? attachment.attachment : null;
}
