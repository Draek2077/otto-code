import type { ReactNode } from "react";
import type { TFunction } from "i18next";
import {
  CircleDot,
  FileText,
  Folder,
  GitPullRequest,
  MessageSquareCode,
  MousePointer2,
} from "@/components/icons/material-icons";
import { withUnistyles } from "react-native-unistyles";
import type { AgentAttachment } from "@otto-code/protocol/messages";
import type { WorkspaceComposerAttachment } from "@/attachments/types";
import { getFileTypeLabel } from "@/attachments/file-types";
import { isPullRequestContextAttachment } from "@/attachments/workspace-attachment-utils";
import type { Theme } from "@/styles/theme";

export interface AttachmentPillContent {
  icon: ReactNode;
  title: string;
  subtitle: string;
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
    case "github_pr":
      return {
        icon: attachmentGithubPrIcon,
        title: attachment.title,
        subtitle: `PR #${attachment.number}`,
      };
    case "github_issue":
      return {
        icon: attachmentGithubIssueIcon,
        title: attachment.title,
        subtitle: `Issue #${attachment.number}`,
      };
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
  if (attachment.kind === "file_context") {
    const isDirectory = attachment.entryKind === "directory";
    const fileName = attachment.path.split("/").findLast(Boolean) ?? attachment.path;
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

// `size` is folded into uniProps (not a static prop) so it repaints from the live,
// compact-doubled `theme.iconSize` the same way `color` already does. Safe here even
// though these icons are module-level consts (not components) — uniProps re-runs on
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
