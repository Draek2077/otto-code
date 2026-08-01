import { getForgeDefinitionOrNeutral } from "@otto-code/protocol/forge-manifest";
import type { AgentAttachment, GitHostingProviderId } from "@otto-code/protocol/messages";
import { normalizeGitHostingProviderId } from "@otto-code/protocol/messages";
import type { AgentPromptContentBlock, AgentPromptInput } from "./agent-sdk-types.js";

const REVIEW_LINE_MARKERS = { add: "+", remove: "-", context: " " } as const;

// COMPAT(hostingAttachments): added in v0.7.6, remove after 2027-02-01.
// `hosting_pr` / `hosting_issue` are the pre-forge attachment kinds. Otto's own
// clients send `forge_*` now, but the protocol still accepts these
// (HostingPrAttachmentSchema / HostingIssueAttachmentSchema in messages.ts), so
// a client built before the forge merge can still attach a PR to a prompt.
// Without these arms the switch fell through to the exhaustiveness throw and
// took the prompt-build path down for every provider. Drop both arms in the
// same change that drops the schemas.
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

export function buildAgentPrompt(
  text: string,
  images?: Array<{ data: string; mimeType: string }>,
  attachments?: AgentAttachment[],
): AgentPromptInput {
  const normalized = text.trim();
  const hasImages = (images?.length ?? 0) > 0;
  const hasAttachments = (attachments?.length ?? 0) > 0;
  if (!hasImages && !hasAttachments) {
    return normalized;
  }

  const chatHistoryAttachments: AgentAttachment[] = [];
  const otherAttachments: AgentAttachment[] = [];
  for (const attachment of attachments ?? []) {
    if (attachment.type === "text" && attachment.contextKind === "chat_history") {
      chatHistoryAttachments.push(attachment);
    } else {
      otherAttachments.push(attachment);
    }
  }

  const blocks: AgentPromptContentBlock[] = [...chatHistoryAttachments];
  if (normalized.length > 0) {
    blocks.push({ type: "text", text: normalized });
  }
  for (const image of images ?? []) {
    blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  blocks.push(...otherAttachments);
  return blocks;
}

export function renderPromptAttachmentAsText(attachment: AgentAttachment): string {
  switch (attachment.type) {
    case "forge_change_request": {
      return renderChangeRequestAttachment({
        forge: attachment.forge,
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
        projectPath: attachment.projectPath,
        baseRefName: attachment.baseRefName,
        headRefName: attachment.headRefName,
      });
    }
    case "github_pr": {
      return renderChangeRequestAttachment({
        forge: "github",
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
        baseRefName: attachment.baseRefName,
        headRefName: attachment.headRefName,
      });
    }
    case "forge_issue": {
      return renderIssueAttachment({
        forge: attachment.forge,
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
        projectPath: attachment.projectPath,
      });
    }
    case "github_issue": {
      return renderIssueAttachment({
        forge: "github",
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
      });
    }
    // COMPAT(hostingAttachments): added in v0.7.6, remove after 2027-02-01.
    // No hosting provider is a registered forge — Bitbucket rides the `github`
    // forge id as a routing facade (bootstrap.ts) — so the provider id is passed
    // through as an unknown forge, which yields the neutral "PR"/"#" grammar
    // both providers use, and only the brand label is resolved separately.
    case "hosting_pr": {
      return renderChangeRequestAttachment({
        forge: attachment.provider,
        displayName: hostingProviderLabel(attachment.provider),
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
        baseRefName: attachment.baseRefName,
        headRefName: attachment.headRefName,
      });
    }
    case "hosting_issue": {
      return renderIssueAttachment({
        forge: attachment.provider,
        displayName: hostingProviderLabel(attachment.provider),
        number: attachment.number,
        title: attachment.title,
        url: attachment.url,
        body: attachment.body,
      });
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
    default: {
      // Compile-time exhaustiveness. A schema branch added to
      // AgentAttachmentSchema with no arm here is a type error, not a runtime
      // throw on the prompt-build path — which is exactly how the hosting_*
      // arms went missing without a single test or typecheck noticing.
      const unhandled: never = attachment;
      throw new Error(`unsupported prompt attachment: ${(unhandled as AgentAttachment).type}`);
    }
  }
}

function renderChangeRequestAttachment(input: {
  forge: string;
  /** Brand label override for non-forge sources; defaults to the forge's. */
  displayName?: string;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  projectPath?: string;
  baseRefName?: string | null;
  headRefName?: string | null;
}): string {
  const lines = [
    `${input.displayName ?? formatForgeLabel(input.forge)} ${formatChangeRequestAbbrev(input.forge)} ${formatChangeRequestNumber(input.forge, input.number)}: ${input.title}`,
    input.url,
  ];
  if (input.projectPath) {
    lines.push(`Project: ${input.projectPath}`);
  }
  if (input.baseRefName) {
    lines.push(`Base: ${input.baseRefName}`);
  }
  if (input.headRefName) {
    lines.push(`Head: ${input.headRefName}`);
  }
  if (input.body) {
    lines.push("", input.body);
  }
  return lines.join("\n");
}

function renderIssueAttachment(input: {
  forge: string;
  /** Brand label override for non-forge sources; defaults to the forge's. */
  displayName?: string;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  projectPath?: string;
}): string {
  const lines = [
    `${input.displayName ?? formatForgeLabel(input.forge)} Issue ${formatIssueNumber(input.forge, input.number)}: ${input.title}`,
    input.url,
  ];
  if (input.projectPath) {
    lines.push(`Project: ${input.projectPath}`);
  }
  if (input.body) {
    lines.push("", input.body);
  }
  return lines.join("\n");
}

function formatForgeLabel(forge: string): string {
  return getForgeDefinitionOrNeutral(forge).displayName;
}

function formatChangeRequestAbbrev(forge: string): string {
  return getForgeDefinitionOrNeutral(forge).changeRequestAbbrev;
}

function formatChangeRequestNumber(forge: string, number: number): string {
  return `${getForgeDefinitionOrNeutral(forge).changeRequestNumberPrefix}${number}`;
}

function formatIssueNumber(forge: string, number: number): string {
  return `${getForgeDefinitionOrNeutral(forge).issueNumberPrefix}${number}`;
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
