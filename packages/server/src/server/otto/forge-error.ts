import { GitHubCommandError } from "../../services/github-service.js";

/** Keep full command diagnostics in daemon logs; Changes needs a useful, bounded explanation. */
export function forgeStatusErrorMessage(error: unknown): string {
  if (error instanceof GitHubCommandError) {
    if (/could not resolve to a repository|repository not found/iu.test(error.stderr))
      return "GitHub could not find this repository or this host's current CLI account cannot access it. Check the repository URL and the account's repository permissions on this host.";
    return "GitHub pull-request status could not be read. Check this host's GitHub CLI connection and use Refresh to try again.";
  }
  return error instanceof Error
    ? error.message
    : "Pull-request status is unavailable on this host.";
}
