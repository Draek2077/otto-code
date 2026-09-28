import { parseGitHubRemoteUrl } from "@otto-code/protocol/git-remote";
import { resolveForgeConnectionRemote } from "../../services/git-hosting/connection-drivers.js";

export async function readKanbanProjectGitHubRemote(
  rootPath: string,
): Promise<{ owner: string; repo: string } | null> {
  try {
    // Resolve SSH aliases before checking the host; github.com-ttc is still
    // github.com for API routing and owner discovery.
    const remote = await resolveForgeConnectionRemote(rootPath);
    const parsed = remote?.host === "github.com" ? parseGitHubRemoteUrl(remote.url) : null;
    return parsed ? { owner: parsed.owner, repo: parsed.repo } : null;
  } catch {
    // A project without a readable origin simply has no repo scoping.
    return null;
  }
}
