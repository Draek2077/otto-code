import { describe, expect, it, vi } from "vitest";
import { createGitHostingProviderForgeAdapter } from "./router.js";

describe("createGitHostingProviderForgeAdapter", () => {
  it("pins a Forge adapter to its configured hosting provider", async () => {
    const bitbucket = {
      getCurrentPullRequestStatus: vi.fn(async () => null),
    };
    const resolver = {
      resolveForCwd: vi.fn(),
      resolveForProvider: vi.fn(() => ({
        providerId: "bitbucket-cloud" as const,
        capabilities: {},
        service: bitbucket,
        credentialsMissing: false as const,
      })),
      invalidate: vi.fn(),
      dispose: vi.fn(),
    };
    const adapter = createGitHostingProviderForgeAdapter(resolver as never, "bitbucket-cloud");

    await adapter.getCurrentPullRequestStatus({ cwd: "/repo", headRef: "feature" });

    expect(resolver.resolveForProvider).toHaveBeenCalledWith("bitbucket-cloud");
    expect(resolver.resolveForCwd).not.toHaveBeenCalled();
    expect(bitbucket.getCurrentPullRequestStatus).toHaveBeenCalledWith({
      cwd: "/repo",
      headRef: "feature",
    });
  });
});
