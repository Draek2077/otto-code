import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
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
 * Projects the daemon config's kanban section down to the provider view.
 * Each provider reads only its own credential; new providers extend
 * MutableKanbanProviderConfig and this projection.
 */
export function projectKanbanProviderConfig(
  config: MutableDaemonConfig,
): MutableKanbanProviderConfig {
  const githubToken = config.kanban?.providers?.github?.token ?? null;
  const jiraToken = config.kanban?.providers?.jira?.token ?? null;
  return {
    ...(githubToken !== null ? { githubToken } : {}),
    ...(jiraToken !== null ? { jiraToken } : {}),
  };
}

export function createKanbanRegistry(readConfig: () => MutableDaemonConfig): KanbanRegistry {
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
      await provider.initialize(projectKanbanProviderConfig(readConfig()));
    },
    dispose: () => {
      for (const provider of providers.values()) {
        provider.dispose?.();
      }
      providers.clear();
    },
  };
}
