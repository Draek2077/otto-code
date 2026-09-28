import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import { readAtlassianCredentials } from "../../services/git-hosting/atlassian-credentials.js";
import type { ForgeConnectionStore } from "../../services/git-hosting/connection-store.js";
import { resolveKanbanGitHubCredential, type KanbanGitHubCredential } from "./github-cli-token.js";
import { GitHubProjectV2Provider } from "./github-provider.js";
import { InMemoryKanbanProvider } from "./memory-provider.js";
import { JiraKanbanProvider } from "./jira-provider.js";
import type { KanbanProvider, MutableKanbanProviderConfig } from "./types.js";

/**
 * The Kanban provider registry - the same litmus test as the forge registry:
 * adding a provider means implementing KanbanProvider in a new file and one
 * entry in the registrations below. The daemon controller and the wire never
 * learn which provider serves a board.
 *
 * `memory` is the always-registered mock (plan Step 2): it proves the RPC
 * serialization flow without credentials and is the default board a new
 * client sees.
 */
export interface KanbanRegistry {
  /** All registered provider ids, in registration order. */
  listProviderIds(): string[];
  /** The provider for an id, or null when unknown. */
  getProvider(providerId: string): KanbanProvider | null;
  /**
   * Initializes the given provider with its current credentials. Called
   * lazily on first use per provider and again when credentials rotate.
   */
  initialize(providerId: string): Promise<void>;
  dispose(): void;
}

/**
 * Projects the host's existing credentials down to the provider view.
 *
 * Kanban authors no credentials of its own: GitHub comes from the project's
 * selected Git connection, falling back to the `gh` CLI when none is selected,
 * Jira from the shared Atlassian account credential that Bitbucket git hosting
 * already uses. The retired `kanban.providers.*.token` config is deliberately
 * not read - a stale hand-edited token must not quietly outrank the host's real
 * authentication.
 */
export async function projectKanbanProviderConfig(
  config: MutableDaemonConfig,
  resolveGitHubCredential: () => Promise<KanbanGitHubCredential>,
  providerId = "github",
): Promise<MutableKanbanProviderConfig> {
  const github = providerId === "github" ? await resolveGitHubCredential() : { token: null };
  const atlassian = readAtlassianCredentials(config);
  return {
    ...(github.token !== null ? { githubToken: github.token } : {}),
    ...(github.account ? { githubAccount: github.account } : {}),
    ...(github.method ? { githubCredentialMethod: github.method } : {}),
    ...(atlassian
      ? {
          atlassianEmail: atlassian.email,
          atlassianApiToken: atlassian.apiToken,
          jiraSiteUrl: atlassian.jiraSiteUrl,
        }
      : {}),
  };
}

export interface KanbanRegistryOptions {
  readConfig: () => MutableDaemonConfig;
  projectId?: string;
  connections?: ForgeConnectionStore;
  /** Injectable so tests never shell out to a real gh binary. */
  resolveGitHubCredential?: () => Promise<KanbanGitHubCredential>;
}

export function createKanbanRegistry(options: KanbanRegistryOptions): KanbanRegistry {
  const { readConfig } = options;
  const resolveGitHubCredential =
    options.resolveGitHubCredential ??
    (() => resolveKanbanGitHubCredential(options.connections, options.projectId));
  const providers = new Map<string, KanbanProvider>();
  const register = (provider: KanbanProvider): void => {
    if (!providers.has(provider.providerId)) {
      providers.set(provider.providerId, provider);
    }
  };

  register(new InMemoryKanbanProvider({ providerId: "memory" }));
  register(new GitHubProjectV2Provider());
  register(new JiraKanbanProvider());

  return {
    listProviderIds: () => [...providers.keys()],
    getProvider: (providerId) => providers.get(providerId) ?? null,
    async initialize(providerId: string): Promise<void> {
      const provider = providers.get(providerId);
      if (!provider) {
        throw new Error(`No kanban provider registered for: ${providerId}`);
      }
      await provider.initialize(
        await projectKanbanProviderConfig(readConfig(), resolveGitHubCredential, providerId),
      );
    },
    dispose: () => {
      for (const provider of providers.values()) {
        provider.dispose?.();
      }
      providers.clear();
    },
  };
}
