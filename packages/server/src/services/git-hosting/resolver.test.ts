import { describe, expect, it } from "vitest";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import type { GitHubService } from "../github-service.js";
import { createGitHostingResolver, deriveProviderFromRemote } from "./resolver.js";
import { GITHUB_CAPABILITIES, type GitHostingService } from "./types.js";

function createGithubStub(): GitHostingService {
  const stub: Partial<GitHubService> = {
    invalidate: () => {},
    dispose: () => {},
  };
  return Object.assign(stub as GitHubService, {
    providerId: "github" as const,
    capabilities: GITHUB_CAPABILITIES,
  });
}

function baseConfig(overrides?: Partial<MutableDaemonConfig>): MutableDaemonConfig {
  return {
    mcp: { injectIntoAgents: false },
    browserTools: { enabled: false },
    providers: {},
    metadataGeneration: { providers: [] },
    autoArchiveAfterMerge: false,
    enableTerminalAgentHooks: false,
    appendSystemPrompt: "",
    ...overrides,
  } as MutableDaemonConfig;
}

function createResolver(params: {
  remoteUrl?: string | null;
  override?: unknown;
  config?: MutableDaemonConfig;
  github?: GitHostingService;
}) {
  const github = params.github ?? createGithubStub();
  const resolver = createGitHostingResolver({
    github,
    getDaemonConfig: () => params.config ?? baseConfig(),
    ottoHome: "C:/otto-home",
    readOttoConfigJson: () =>
      params.override === undefined ? {} : { gitHosting: { provider: params.override } },
    resolveRepoRoot: async () => "C:/repos/widgets",
    resolveRemoteUrl: async () =>
      params.remoteUrl === undefined ? "git@github.com:acme/widgets.git" : params.remoteUrl,
  });
  return { resolver, github };
}

const BITBUCKET_CONFIG = baseConfig({
  gitHosting: {
    providers: { bitbucketCloud: { email: "dev@example.com", apiToken: "token" } },
  },
});

describe("deriveProviderFromRemote", () => {
  it("maps github.com remotes (https and scp-style) to github", () => {
    expect(deriveProviderFromRemote("https://github.com/acme/widgets.git")).toBe("github");
    expect(deriveProviderFromRemote("git@github.com:acme/widgets.git")).toBe("github");
  });

  it("maps bitbucket.org remotes to bitbucket-cloud", () => {
    expect(deriveProviderFromRemote("https://bitbucket.org/acme/widgets.git")).toBe(
      "bitbucket-cloud",
    );
    expect(deriveProviderFromRemote("git@bitbucket.org:acme/widgets.git")).toBe("bitbucket-cloud");
  });

  it("returns null for unknown hosts and empty input", () => {
    expect(deriveProviderFromRemote("https://gitlab.com/acme/widgets.git")).toBeNull();
    expect(deriveProviderFromRemote(null)).toBeNull();
  });
});

describe("git hosting resolver", () => {
  it("resolves GitHub from a github.com remote", async () => {
    const { resolver, github } = createResolver({ remoteUrl: "git@github.com:acme/widgets.git" });
    const resolved = await resolver.resolveForCwd("C:/repos/widgets");
    expect(resolved.providerId).toBe("github");
    expect(resolved.service).toBe(github);
  });

  it("resolves Bitbucket from a bitbucket.org remote when host credentials exist", async () => {
    const { resolver } = createResolver({
      remoteUrl: "git@bitbucket.org:acme/widgets.git",
      config: BITBUCKET_CONFIG,
    });
    const resolved = await resolver.resolveForCwd("C:/repos/widgets");
    expect(resolved.providerId).toBe("bitbucket-cloud");
    expect(resolved.service).not.toBeNull();
    expect(resolved.service?.providerId).toBe("bitbucket-cloud");
  });

  it("reports missing credentials for a Bitbucket remote with no host token", async () => {
    const { resolver } = createResolver({ remoteUrl: "git@bitbucket.org:acme/widgets.git" });
    const resolved = await resolver.resolveForCwd("C:/repos/widgets");
    expect(resolved.providerId).toBe("bitbucket-cloud");
    expect(resolved.service).toBeNull();
    expect(resolved.credentialsMissing).toBe(true);
    expect(resolved.capabilities.autoMerge).toBe(false);
  });

  it("honors an otto.json provider override against the remote host", async () => {
    const { resolver } = createResolver({
      remoteUrl: "git@github.com:acme/widgets.git",
      override: "bitbucket-cloud",
      config: BITBUCKET_CONFIG,
    });
    const resolved = await resolver.resolveForCwd("C:/repos/widgets");
    expect(resolved.providerId).toBe("bitbucket-cloud");
    expect(resolved.service).not.toBeNull();
  });

  it("defaults to GitHub for an unknown remote host", async () => {
    const { resolver, github } = createResolver({
      remoteUrl: "git@gitlab.example.com:acme/widgets.git",
    });
    const resolved = await resolver.resolveForCwd("C:/repos/widgets");
    expect(resolved.providerId).toBe("github");
    expect(resolved.service).toBe(github);
  });

  it("reuses one Bitbucket service instance across resolutions and rotates on credential change", async () => {
    let token = "token-a";
    const github = createGithubStub();
    const resolver = createGitHostingResolver({
      github,
      getDaemonConfig: () =>
        baseConfig({
          gitHosting: {
            providers: { bitbucketCloud: { email: "dev@example.com", apiToken: token } },
          },
        }),
      ottoHome: "C:/otto-home",
      readOttoConfigJson: () => ({}),
      resolveRepoRoot: async () => "C:/repos/widgets",
      resolveRemoteUrl: async () => "git@bitbucket.org:acme/widgets.git",
    });

    const first = await resolver.resolveForCwd("C:/repos/widgets");
    resolver.invalidateAll();
    const second = await resolver.resolveForCwd("C:/repos/widgets");
    expect(second.service).toBe(first.service);

    token = "token-b";
    resolver.invalidateAll();
    const third = await resolver.resolveForCwd("C:/repos/widgets");
    expect(third.service).not.toBe(first.service);
  });

  it("resolveForProvider answers host-level auth-status queries", async () => {
    const { resolver } = createResolver({ config: BITBUCKET_CONFIG });
    const github = resolver.resolveForProvider("github");
    expect(github.service).not.toBeNull();
    const bitbucket = resolver.resolveForProvider("bitbucket-cloud");
    expect(bitbucket.service).not.toBeNull();

    const { resolver: noCreds } = createResolver({});
    expect(noCreds.resolveForProvider("bitbucket-cloud").credentialsMissing).toBe(true);
  });
});
