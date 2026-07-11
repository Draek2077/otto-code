import { createGitHubService } from "../github-service.js";
import { GITHUB_CAPABILITIES, type GitHostingService } from "./types.js";

// GitHub adapter: the existing gh-CLI service tagged with its provider
// identity and capabilities. Behavior is unchanged.
export function createGitHubHostingService(
  options: Parameters<typeof createGitHubService>[0] = {},
): GitHostingService {
  return Object.assign(createGitHubService(options), {
    providerId: "github" as const,
    capabilities: GITHUB_CAPABILITIES,
  });
}
