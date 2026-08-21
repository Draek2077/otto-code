import type {
  ComposerAttachment,
  PullRequestContextAttachment,
  UserComposerAttachment,
  WorkspaceComposerAttachment,
} from "@/attachments/types";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import { formatFileContextSelection } from "@/attachments/file-context";

export function isPullRequestContextAttachment(
  attachment: ComposerAttachment | undefined,
): attachment is PullRequestContextAttachment {
  return (
    attachment?.kind === "forge.change_request_comment" ||
    attachment?.kind === "forge.change_request_review" ||
    attachment?.kind === "forge.change_request_check" ||
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
    attachment?.kind === "meeting_transcript" ||
    attachment?.kind === "file_context" ||
    attachment?.kind === "rendered_document" ||
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
      attachment.kind !== "meeting_transcript" &&
      attachment.kind !== "file_context" &&
      attachment.kind !== "rendered_document" &&
      !isPullRequestContextAttachment(attachment),
  );
}

function formatRenderedDocumentLocator(
  locator: Extract<WorkspaceComposerAttachment, { kind: "rendered_document" }>["locator"],
): string {
  if (locator.kind === "heading") {
    return `heading level ${locator.level}, lines ${locator.lineStart}-${locator.lineEnd}`;
  }
  if (locator.kind === "fence") {
    return `fenced code${locator.language ? ` (${locator.language})` : ""}, lines ${locator.lineStart}-${locator.lineEnd}`;
  }
  return `${locator.kind}, lines ${locator.lineStart}-${locator.lineEnd}`;
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
  if (attachment.kind === "meeting_transcript") {
    return {
      type: "text",
      mimeType: "text/plain",
      title: attachment.title,
      text: [
        "Meeting transcript attached as context by the user.",
        `Meeting time: ${attachment.occurredAt}`,
        "",
        attachment.content,
      ].join("\n"),
    };
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
    // A reference, not an excerpt. Pasting the selected text would cost the
    // whole range in tokens and would go stale the moment the agent edits the
    // file, so the range points at what to read instead of duplicating it.
    if (attachment.selection) {
      const range = formatFileContextSelection(attachment.selection);
      return {
        type: "text",
        mimeType: "text/plain",
        title: `File · ${attachment.path}:${range}`,
        text: [
          "Workspace file selection attached as context by the user.",
          `Path: ${attachment.path}`,
          `Selection: line ${attachment.selection.startLine} column ${attachment.selection.startColumn} to line ${attachment.selection.endLine} column ${attachment.selection.endColumn}`,
          "Read this file, focusing on the selected range above, before responding.",
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
  if (attachment.kind === "rendered_document") {
    const locator = attachment.locator;
    const sourceLocator = formatRenderedDocumentLocator(locator);
    return {
      type: "text",
      mimeType: "text/plain",
      title: `Document annotation · ${attachment.path}:${locator.lineStart}`,
      text: [
        "Rendered workspace document item attached as context by the user.",
        `Path: ${attachment.path}`,
        `Source locator: ${sourceLocator}`,
        "",
        "Rendered excerpt:",
        attachment.excerpt,
        "",
        "User note:",
        attachment.comment,
        "",
        "Read the current workspace file before responding; this annotation identifies the rendered item the user meant.",
      ].join("\n"),
    };
  }
  return attachment.kind === "review" ? attachment.attachment : null;
}
