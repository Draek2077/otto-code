import type { AgentAttachment, GitHostingProviderId } from "@otto-code/protocol/messages";
import { normalizeGitHostingProviderId } from "@otto-code/protocol/messages";

const REVIEW_LINE_MARKERS = { add: "+", remove: "-", context: " " } as const;

const HOSTING_PROVIDER_LABELS: Record<GitHostingProviderId, string> = {
  github: "GitHub",
  "bitbucket-cloud": "Bitbucket",
};

// The wire provider id is an open string (forward-compat), so degrade to a
// neutral label for a provider this build doesn't recognize.
function hostingProviderLabel(provider: string): string {
  const known = normalizeGitHostingProviderId(provider);
  return known ? HOSTING_PROVIDER_LABELS[known] : "Git";
}

export function renderPromptAttachmentAsText(attachment: AgentAttachment): string {
  switch (attachment.type) {
    case "github_pr": {
      const lines = [`GitHub PR #${attachment.number}: ${attachment.title}`, attachment.url];
      if (attachment.baseRefName) {
        lines.push(`Base: ${attachment.baseRefName}`);
      }
      if (attachment.headRefName) {
        lines.push(`Head: ${attachment.headRefName}`);
      }
      if (attachment.body) {
        lines.push("", attachment.body);
      }
      return lines.join("\n");
    }
    case "github_issue": {
      const lines = [`GitHub Issue #${attachment.number}: ${attachment.title}`, attachment.url];
      if (attachment.body) {
        lines.push("", attachment.body);
      }
      return lines.join("\n");
    }
    case "hosting_pr": {
      const label = hostingProviderLabel(attachment.provider);
      const lines = [`${label} PR #${attachment.number}: ${attachment.title}`, attachment.url];
      if (attachment.baseRefName) {
        lines.push(`Base: ${attachment.baseRefName}`);
      }
      if (attachment.headRefName) {
        lines.push(`Head: ${attachment.headRefName}`);
      }
      if (attachment.body) {
        lines.push("", attachment.body);
      }
      return lines.join("\n");
    }
    case "hosting_issue": {
      const label = hostingProviderLabel(attachment.provider);
      const lines = [`${label} Issue #${attachment.number}: ${attachment.title}`, attachment.url];
      if (attachment.body) {
        lines.push("", attachment.body);
      }
      return lines.join("\n");
    }
    case "text": {
      return attachment.text;
    }
    case "review": {
      const lines = [`Otto review attachment (${attachment.mode})`, `CWD: ${attachment.cwd}`];
      if (attachment.baseRef) {
        lines.push(`Base: ${attachment.baseRef}`);
      }
      attachment.comments.forEach((comment, index) => {
        lines.push(
          "",
          `Comment ${index + 1}: ${comment.filePath}:${comment.side}:${comment.lineNumber}`,
          comment.body,
          comment.context.hunkHeader,
        );
        const target = comment.context.targetLine;
        for (const line of comment.context.lines) {
          const isTarget =
            line.oldLineNumber === target.oldLineNumber &&
            line.newLineNumber === target.newLineNumber &&
            line.type === target.type &&
            line.content === target.content;
          const prefix = isTarget ? "> " : "  ";
          const oldLn = padLineNumber(line.oldLineNumber);
          const newLn = padLineNumber(line.newLineNumber);
          lines.push(`${prefix}${oldLn} ${newLn} ${REVIEW_LINE_MARKERS[line.type]}${line.content}`);
        }
      });
      return lines.join("\n");
    }
    case "uploaded_file": {
      return [
        `Uploaded file: ${attachment.fileName}`,
        `Path: ${attachment.path}`,
        `MIME: ${attachment.mimeType}`,
        `Size: ${attachment.size} bytes`,
      ].join("\n");
    }
    default:
      throw new Error("unreachable");
  }
}

function padLineNumber(lineNumber: number | null): string {
  return (lineNumber?.toString() ?? "-").padStart(2);
}

export function buildAgentBranchNameSeed(
  firstAgentContext: { prompt?: string; attachments?: readonly AgentAttachment[] } | undefined,
): string | undefined {
  if (!firstAgentContext) {
    return undefined;
  }
  const parts: string[] = [];
  const prompt = firstAgentContext.prompt?.trim();
  if (prompt) {
    parts.push(["<user-prompt>", prompt, "</user-prompt>"].join("\n"));
  }
  const renderedAttachments: string[] = [];
  for (const attachment of firstAgentContext.attachments ?? []) {
    const rendered = renderPromptAttachmentAsText(attachment).trim();
    if (rendered) {
      renderedAttachments.push(rendered);
    }
  }
  if (renderedAttachments.length > 0) {
    parts.push(["<attachments>", renderedAttachments.join("\n\n"), "</attachments>"].join("\n"));
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
