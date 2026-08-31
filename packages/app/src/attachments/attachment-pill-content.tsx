import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import React from "react";
import {
  CircleDot,
  FileText,
  Folder,
  MessageSquareCode,
  MousePointer2,
  SpeakerNotes,
} from "@/components/icons/material-icons";
import { GitPullRequest } from "@/components/icons/lucide";
import { withUnistyles } from "react-native-unistyles";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import { getFileTypeLabel } from "@/attachments/file-types";
import { formatFileContextSelection } from "@/attachments/file-context";
import { isPullRequestContextAttachment } from "@/attachments/workspace-attachment-utils";
import type { Theme } from "@/styles/theme";

export interface AttachmentPillContent {
  icon: ReactNode;
  title: string;
  subtitle: string;
}

function getRenderedDocumentAnnotationTitle(
  attachment: Extract<WorkspaceComposerAttachment, { kind: "rendered_document" }>,
  fileName: string,
): string {
  if (attachment.locator.kind === "heading") {
    return attachment.locator.text || fileName;
  }
  if (attachment.locator.kind === "fence") {
    return attachment.locator.language ? `Code · ${attachment.locator.language}` : "Code block";
  }
  return attachment.locator.kind === "blockquote" ? "Quote" : "Paragraph";
}

function getReviewSubtitle(count: number, t: TFunction): string {
  return count === 1
    ? t("message.attachments.commentsOne")
    : t("message.attachments.commentsMany", { count });
}

function getPullRequestContextSubtitle(attachment: WorkspaceComposerAttachment): string {
  if (attachment.kind === "github.pull_request_check") {
    return "Check logs";
  }
  if (attachment.kind === "github.pull_request_comment") {
    return "Comment";
  }
  return "Review";
}

function getTextAttachmentSubtitle(
  attachment: Extract<AgentAttachment, { type: "text" }>,
  t: TFunction,
): string {
  if (attachment.contextKind === "chat_history") {
    return "Previous conversation";
  }
  return t("message.attachments.text");
}

export function getAgentAttachmentPillContent(
  attachment: AgentAttachment,
  t: TFunction,
): AttachmentPillContent {
  switch (attachment.type) {
    case "review":
      return {
        icon: attachmentReviewIcon,
        title: t("message.attachments.review"),
        subtitle: getReviewSubtitle(attachment.comments.length, t),
      };
    case "forge_change_request":
    case "github_pr":
      return {
        icon: attachmentGithubPrIcon,
        title: attachment.title,
        subtitle: `PR #${attachment.number}`,
      };
    case "forge_issue":
    case "github_issue":
      return {
        icon: attachmentGithubIssueIcon,
        title: attachment.title,
        subtitle: `Issue #${attachment.number}`,
      };
    // COMPAT(hostingAttachments): added in v0.7.6, remove after 2027-02-01.
    // The render half of the schemas in protocol/src/messages.ts, which carry
    // the same tag and say to retire both halves together. No current client
    // sends these: the forge merge replaced them with forge_change_request and
    // forge_issue above, and they stay only so a client from before that merge
    // still renders its pills instead of falling through to the default.
    case "hosting_pr":
      return {
        icon: attachmentGithubPrIcon,
        title: attachment.title,
        subtitle: `PR #${attachment.number}`,
      };
    case "hosting_issue":
      return {
        icon: attachmentGithubIssueIcon,
        title: attachment.title,
        subtitle: `Issue #${attachment.number}`,
      };
    case "text":
      if (attachment.externalResource) {
        return {
          icon: attachmentGithubIssueIcon,
          title: attachment.externalResource.title,
          subtitle: `${attachment.externalResource.providerLabel} ${attachment.externalResource.identifier}`,
        };
      }
      return {
        icon: attachmentFileIcon,
        title: attachment.title ?? t("message.attachments.textAttachment"),
        subtitle: getTextAttachmentSubtitle(attachment, t),
      };
    case "uploaded_file":
      return {
        icon: attachmentFileIcon,
        title: attachment.fileName,
        subtitle: getFileTypeLabel(attachment.fileName) ?? t("message.attachments.file"),
      };
  }
}

export function getWorkspaceAttachmentPillContent(
  attachment: WorkspaceComposerAttachment,
  t: TFunction,
): AttachmentPillContent {
  if (attachment.kind === "browser_element") {
    return {
      icon: attachmentBrowserIcon,
      title: attachment.attachment.tag,
      subtitle: t("composer.attachments.element"),
    };
  }
  if (isPullRequestContextAttachment(attachment)) {
    return {
      icon: attachmentFileIcon,
      title: attachment.title,
      subtitle: getPullRequestContextSubtitle(attachment),
    };
  }
  if (attachment.kind === "chat_history") {
    return {
      icon: attachmentFileIcon,
      title: attachment.attachment.title ?? t("message.attachments.textAttachment"),
      subtitle: getTextAttachmentSubtitle(attachment.attachment, t),
    };
  }
  if (attachment.kind === "meeting_transcript") {
    return {
      icon: attachmentMeetingNotesIcon,
      title: attachment.title,
      subtitle: "Meeting notes",
    };
  }
  if (attachment.kind === "file_context") {
    const isDirectory = attachment.entryKind === "directory";
    const fileName = attachment.path.split("/").findLast(Boolean) ?? attachment.path;
    // The range goes in the TITLE, not the subtitle: it is what distinguishes
    // two pills for the same file, and the subtitle is the first thing the
    // pill truncates.
    if (attachment.selection) {
      return {
        icon: attachmentFileIcon,
        title: `${fileName}:${formatFileContextSelection(attachment.selection)}`,
        subtitle: t("composer.attachments.selectionContext"),
      };
    }
    if (attachment.lineStart != null) {
      return {
        icon: attachmentFileIcon,
        title: `${fileName}:${attachment.lineStart}`,
        subtitle: t("composer.attachments.lineContext"),
      };
    }
    return {
      icon: isDirectory ? attachmentFolderIcon : attachmentFileIcon,
      title: fileName,
      subtitle: isDirectory
        ? t("composer.attachments.folderContext")
        : t("composer.attachments.fileContext"),
    };
  }
  if (attachment.kind === "rendered_document") {
    const fileName = attachment.path.split("/").findLast(Boolean) ?? attachment.path;
    return {
      icon: attachmentReviewIcon,
      title: getRenderedDocumentAnnotationTitle(attachment, fileName),
      subtitle: `${fileName}:${attachment.locator.lineStart} · Document annotation`,
    };
  }
  return {
    icon: attachmentReviewIcon,
    title: t("message.attachments.review"),
    subtitle: getReviewSubtitle(attachment.commentCount, t),
  };
}

const ThemedAttachmentFileText = withUnistyles(FileText);
const ThemedAttachmentFolder = withUnistyles(Folder);
const ThemedAttachmentGitPullRequest = withUnistyles(GitPullRequest);
const ThemedAttachmentCircleDot = withUnistyles(CircleDot);
const ThemedAttachmentMessageSquareCode = withUnistyles(MessageSquareCode);
const ThemedAttachmentMousePointer = withUnistyles(MousePointer2);
const ThemedAttachmentSpeakerNotes = withUnistyles(SpeakerNotes);

// `size` is folded into uniProps (not a static prop) so it repaints from the live,
// compact-doubled `theme.iconSize` the same way `color` already does. Safe here even
// though these icons are module-level consts (not components) - uniProps re-runs on
// the wrapped leaf regardless of where the element was constructed.
const iconForegroundMutedMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

const attachmentReviewIcon = (
  <ThemedAttachmentMessageSquareCode uniProps={iconForegroundMutedMapping} />
);
const attachmentGithubPrIcon = (
  <ThemedAttachmentGitPullRequest uniProps={iconForegroundMutedMapping} />
);
const attachmentGithubIssueIcon = (
  <ThemedAttachmentCircleDot uniProps={iconForegroundMutedMapping} />
);
const attachmentFileIcon = <ThemedAttachmentFileText uniProps={iconForegroundMutedMapping} />;
const attachmentFolderIcon = <ThemedAttachmentFolder uniProps={iconForegroundMutedMapping} />;
const attachmentBrowserIcon = (
  <ThemedAttachmentMousePointer uniProps={iconForegroundMutedMapping} />
);
const attachmentMeetingNotesIcon = (
  <ThemedAttachmentSpeakerNotes uniProps={iconForegroundMutedMapping} />
);
