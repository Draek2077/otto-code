import type {
  AgentAttachment,
  GitHostingProviderId,
  GitHubSearchItem,
} from "@otto-code/protocol/messages";

export function buildGitHubAttachmentFromSearchItem(
  item: GitHubSearchItem | null,
  options?: { provider?: GitHostingProviderId },
): AgentAttachment | null {
  if (!item) {
    return null;
  }

  // Non-GitHub items become provider-tagged hosting attachments. Only new
  // daemons (gitHostingProviders feature) produce non-GitHub search items,
  // so the receiving daemon always understands the hosting_* kinds.
  const provider = options?.provider;
  if (provider && provider !== "github") {
    if (item.kind === "pr") {
      return {
        type: "hosting_pr",
        mimeType: "application/otto-hosting-pr",
        provider,
        number: item.number,
        title: item.title,
        url: item.url,
        ...(item.body ? { body: item.body } : {}),
        ...(item.baseRefName ? { baseRefName: item.baseRefName } : {}),
        ...(item.headRefName ? { headRefName: item.headRefName } : {}),
      };
    }
    return {
      type: "hosting_issue",
      mimeType: "application/otto-hosting-issue",
      provider,
      number: item.number,
      title: item.title,
      url: item.url,
      ...(item.body ? { body: item.body } : {}),
    };
  }

  if (item.kind === "pr") {
    return {
      type: "github_pr",
      mimeType: "application/github-pr",
      number: item.number,
      title: item.title,
      url: item.url,
      ...(item.body ? { body: item.body } : {}),
      ...(item.baseRefName ? { baseRefName: item.baseRefName } : {}),
      ...(item.headRefName ? { headRefName: item.headRefName } : {}),
    };
  }

  return {
    type: "github_issue",
    mimeType: "application/github-issue",
    number: item.number,
    title: item.title,
    url: item.url,
    ...(item.body ? { body: item.body } : {}),
  };
}
