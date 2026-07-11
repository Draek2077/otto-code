import { createHash } from "node:crypto";
import { parseBitbucketCloudRemoteUrl, parseGitHubRemoteUrl } from "@otto-code/protocol/git-remote";
import { OttoConfigSchema } from "@otto-code/protocol/otto-config-schema";
import type {
  GitHostingCapabilities,
  GitHostingProviderId,
  MutableDaemonConfig,
} from "@otto-code/protocol/messages";
import { runGitCommand } from "../../utils/run-git-command.js";
import { parseGitRevParsePath } from "../../utils/git-rev-parse-path.js";
import {
  createBitbucketCloudService,
  type BitbucketCloudCredentials,
} from "./bitbucket-cloud-service.js";
import {
  BITBUCKET_CLOUD_CAPABILITIES,
  GITHUB_CAPABILITIES,
  type GitHostingService,
} from "./types.js";

const RESOLUTION_TTL_MS = 30_000;
const READ_ONLY_GIT_ENV = { GIT_TERMINAL_PROMPT: "0" } as const;

// The outcome of "which hosting provider serves this directory/provider?". A
// provider can be selected but unusable (host credentials not configured yet)
// — that is a features-off state, not an error.
export type ResolvedGitHosting =
  | {
      providerId: GitHostingProviderId;
      capabilities: GitHostingCapabilities;
      service: GitHostingService;
      credentialsMissing: false;
    }
  | {
      providerId: GitHostingProviderId;
      capabilities: GitHostingCapabilities;
      service: null;
      credentialsMissing: true;
    };

export interface GitHostingResolver {
  resolveForCwd(cwd: string): Promise<ResolvedGitHosting>;
  resolveForProvider(providerId: GitHostingProviderId): ResolvedGitHosting;
  // Drops cached resolutions and provider read caches for a cwd — call after
  // local mutations or settings changes affecting that checkout.
  invalidate(cwd: string): void;
  // Drops all cached resolutions (provider credentials changed).
  invalidateAll(): void;
  dispose(): void;
}

export interface GitHostingResolverOptions {
  github: GitHostingService;
  getDaemonConfig: () => MutableDaemonConfig;
  // A default cwd for provider-level operations that aren't tied to a
  // workspace (host auth checks). gh reads global config; Bitbucket ignores it.
  ottoHome: string;
  readOttoConfigJson: (repoRoot: string) => unknown;
  resolveRepoRoot?: (cwd: string) => Promise<string | null>;
  resolveRemoteUrl?: (cwd: string) => Promise<string | null>;
  now?: () => number;
}

async function defaultResolveRepoRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["rev-parse", "--show-toplevel"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    return parseGitRevParsePath(stdout);
  } catch {
    return null;
  }
}

async function defaultResolveRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await runGitCommand(["remote", "get-url", "origin"], {
      cwd,
      envOverlay: READ_ONLY_GIT_ENV,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// A workspace's provider is the host its git remote points at. github.com and
// bitbucket.org are unambiguous; standard SSH (scp-style) remotes parse too.
// Aliased SSH hosts fall through to the otto.json override.
export function deriveProviderFromRemote(remoteUrl: string | null): GitHostingProviderId | null {
  if (!remoteUrl) {
    return null;
  }
  if (parseGitHubRemoteUrl(remoteUrl)) {
    return "github";
  }
  if (parseBitbucketCloudRemoteUrl(remoteUrl)) {
    return "bitbucket-cloud";
  }
  return null;
}

function credentialsFingerprint(credentials: BitbucketCloudCredentials): string {
  // In-memory instance cache key; hashed so the token itself never sits in a
  // Map key that could end up in a heap dump grep or debug log.
  return createHash("sha256").update(`${credentials.email}\n${credentials.apiToken}`).digest("hex");
}

export function createGitHostingResolver(options: GitHostingResolverOptions): GitHostingResolver {
  const now = options.now ?? Date.now;
  const resolveRepoRoot = options.resolveRepoRoot ?? defaultResolveRepoRoot;
  const resolveRemoteUrl = options.resolveRemoteUrl ?? defaultResolveRemoteUrl;
  const resolutionCache = new Map<
    string,
    { value: Promise<ResolvedGitHosting>; expiresAt: number }
  >();
  // The single host-level Bitbucket service, rebuilt when credentials rotate.
  let bitbucketInstance: { fingerprint: string; service: GitHostingService } | null = null;

  function capabilitiesFor(providerId: GitHostingProviderId): GitHostingCapabilities {
    return providerId === "github" ? GITHUB_CAPABILITIES : BITBUCKET_CLOUD_CAPABILITIES;
  }

  function readProviderOverride(repoRoot: string | null): GitHostingProviderId | null {
    if (!repoRoot) {
      return null;
    }
    const parsed = OttoConfigSchema.safeParse(options.readOttoConfigJson(repoRoot) ?? {});
    if (!parsed.success) {
      return null;
    }
    return parsed.data.gitHosting?.provider ?? null;
  }

  function bitbucketCredentials(): BitbucketCloudCredentials | null {
    const config = options.getDaemonConfig();
    const email = config.gitHosting?.providers?.bitbucketCloud?.email?.trim() ?? "";
    const apiToken = config.gitHosting?.providers?.bitbucketCloud?.apiToken?.trim() ?? "";
    if (!email || !apiToken) {
      return null;
    }
    return { email, apiToken };
  }

  function getBitbucketService(credentials: BitbucketCloudCredentials): GitHostingService {
    const fingerprint = credentialsFingerprint(credentials);
    if (bitbucketInstance && bitbucketInstance.fingerprint === fingerprint) {
      return bitbucketInstance.service;
    }
    bitbucketInstance?.service.dispose?.();
    const service = createBitbucketCloudService({
      credentials,
      resolveRemoteUrl,
      now,
    });
    bitbucketInstance = { fingerprint, service };
    return service;
  }

  function resolveForProvider(providerId: GitHostingProviderId): ResolvedGitHosting {
    const capabilities = capabilitiesFor(providerId);
    if (providerId === "github") {
      // GitHub auth is owned by the gh CLI; we always have a path to try, and
      // isAuthenticated reports the real state.
      return { providerId, capabilities, service: options.github, credentialsMissing: false };
    }
    const credentials = bitbucketCredentials();
    if (!credentials) {
      return { providerId, capabilities, service: null, credentialsMissing: true };
    }
    return {
      providerId,
      capabilities,
      service: getBitbucketService(credentials),
      credentialsMissing: false,
    };
  }

  async function resolveUncached(cwd: string): Promise<ResolvedGitHosting> {
    const repoRoot = await resolveRepoRoot(cwd);
    const override = readProviderOverride(repoRoot);
    const remoteUrl = await resolveRemoteUrl(cwd);
    const providerId = override ?? deriveProviderFromRemote(remoteUrl) ?? "github";
    return resolveForProvider(providerId);
  }

  return {
    resolveForCwd(cwd: string): Promise<ResolvedGitHosting> {
      const cached = resolutionCache.get(cwd);
      if (cached && cached.expiresAt > now()) {
        return cached.value;
      }
      const value = resolveUncached(cwd).catch((error) => {
        resolutionCache.delete(cwd);
        throw error;
      });
      resolutionCache.set(cwd, { value, expiresAt: now() + RESOLUTION_TTL_MS });
      return value;
    },

    resolveForProvider,

    invalidate(cwd: string): void {
      resolutionCache.delete(cwd);
      options.github.invalidate({ cwd });
      bitbucketInstance?.service.invalidate({ cwd });
    },

    invalidateAll(): void {
      resolutionCache.clear();
    },

    dispose(): void {
      resolutionCache.clear();
      bitbucketInstance?.service.dispose?.();
      bitbucketInstance = null;
      options.github.dispose?.();
    },
  };
}
