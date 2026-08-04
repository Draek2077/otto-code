import {
  isGitHubHost,
  parseGitHubRemoteIdentity,
  parseGitRemoteLocation,
  type GitHubRemoteIdentity as ResolvedGitHubRemoteIdentity,
} from "@otto-code/protocol/git-remote";
import { resolveSshHostname, type SshHostnameResolver } from "./ssh-hostname.js";

export { parseGitHubRemoteUrl, type GitHubRemoteIdentity } from "@otto-code/protocol/git-remote";
export { resolveSshHostname, type SshHostnameResolver } from "./ssh-hostname.js";

/**
 * GitHub-specific remote identity resolution.
 *
 * Upstream v0.2.5 split the original `github-remote.ts` in two: the generic SSH
 * half became `ssh-hostname.ts` (kept verbatim, including its 5s `ssh -G`
 * timeout that our copy lacked), and the forge-specific half moved into
 * `services/forge-resolver.ts` (`parseRemoteHost` / `forgeForHost`).
 *
 * Otto keeps this one function because `services/github-service.ts` is still
 * GitHub-shaped. Folding it into the forge resolver belongs to the Bitbucket
 * re-attachment - see findings/upstream/2026-07-31-deleted-file-audit.md.
 */
export async function resolveGitHubRemote(input: {
  remoteUrl: string;
  resolveSshHostname?: SshHostnameResolver;
}): Promise<ResolvedGitHubRemoteIdentity | null> {
  const location = parseGitRemoteLocation(input.remoteUrl);
  if (!location) return null;
  if (isGitHubHost(location.host)) return parseGitHubRemoteIdentity(location.path);
  if (location.transport !== "scp" && location.transport !== "ssh") return null;

  const resolve = input.resolveSshHostname ?? resolveSshHostname;
  const resolvedHost = await resolve(location.host);
  if (!resolvedHost || !isGitHubHost(resolvedHost)) return null;
  return parseGitHubRemoteIdentity(location.path);
}
