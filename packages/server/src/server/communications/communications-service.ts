import type {
  CommunicationConversationSummary,
  CommunicationMessage,
  CommunicationPresence,
  CommunicationPresenceStatus,
  CommunicationProviderId,
  CommunicationProviderSummary,
  CommunicationSearchResult,
  CommunicationsInboxHome,
  CommunicationsOverview,
} from "@otto-code/protocol/communications";

/**
 * The seam a provider adapter implements. Zoom is the first proof adapter, but
 * this service intentionally knows nothing about Zoom OAuth, Team Chat routes,
 * or a provider desktop client.
 */
export interface CommunicationsProvider {
  readonly id: CommunicationProviderId;
  getSummary(): Promise<CommunicationProviderSummary>;
  getConversationSummaries(): Promise<CommunicationConversationSummary[]>;
  getHome?(): Promise<CommunicationsInboxHome>;
  searchDestinations?(query: string): Promise<CommunicationSearchResult[]>;
  setFavorite?(conversationId: string, favorite: boolean): Promise<CommunicationsInboxHome>;
  getPresence?(): Promise<CommunicationPresence>;
  subscribePresenceChanges?(listener: (presence: CommunicationPresence) => void): () => void;
  setPresence?(status: CommunicationPresenceStatus): Promise<CommunicationPresence>;
  setEnabled?(enabled: boolean): Promise<CommunicationPresence>;
  getMessages?(conversationId: string): Promise<CommunicationMessage[]>;
  sendMessage?(conversationId: string, text: string): Promise<CommunicationMessage>;
}

/**
 * Daemon-global communications projection. A single instance is shared by all
 * sessions so a later provider adapter and its durable state never fork per
 * frontend connection.
 */
export class CommunicationsService {
  private readonly providers = new Map<CommunicationProviderId, CommunicationsProvider>();
  private readonly presenceListeners = new Set<(presence: CommunicationPresence) => void>();

  registerProvider(provider: CommunicationsProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Communications provider '${provider.id}' is already registered.`);
    }
    this.providers.set(provider.id, provider);
    const unsubscribeProviderPresence = provider.subscribePresenceChanges?.((presence) => {
      for (const listener of this.presenceListeners) listener(presence);
    });
    return () => {
      this.providers.delete(provider.id);
      unsubscribeProviderPresence?.();
    };
  }

  /** Subscribe to daemon-owned provider presence changes across every frontend. */
  subscribePresenceChanges(listener: (presence: CommunicationPresence) => void): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  async getOverview(): Promise<CommunicationsOverview> {
    const providers = [...this.providers.values()];
    const providerSummaries = await Promise.all(providers.map((provider) => provider.getSummary()));
    const conversationGroups = await Promise.all(
      providers.map((provider) => provider.getConversationSummaries()),
    );
    const conversations = conversationGroups
      .flat()
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""));

    return {
      providers: providerSummaries,
      conversations,
      unreadCount: conversations.reduce(
        (count, conversation) => count + conversation.unreadCount,
        0,
      ),
    };
  }

  async getMessages(input: {
    providerId: CommunicationProviderId;
    conversationId: string;
  }): Promise<CommunicationMessage[]> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.getMessages) {
      throw new Error("This conversation does not support message reading.");
    }
    return provider.getMessages(input.conversationId);
  }

  async getHome(providerId: CommunicationProviderId): Promise<CommunicationsInboxHome> {
    const provider = this.providers.get(providerId);
    if (!provider?.getHome) {
      throw new Error("This provider does not support a Chat Home.");
    }
    return provider.getHome();
  }

  async searchDestinations(input: {
    providerId: CommunicationProviderId;
    query: string;
  }): Promise<CommunicationSearchResult[]> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.searchDestinations) {
      throw new Error("This provider does not support destination search.");
    }
    return provider.searchDestinations(input.query);
  }

  async setFavorite(input: {
    providerId: CommunicationProviderId;
    conversationId: string;
    favorite: boolean;
  }): Promise<CommunicationsInboxHome> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.setFavorite) {
      throw new Error("This provider does not support favorites.");
    }
    return provider.setFavorite(input.conversationId, input.favorite);
  }

  async getPresence(providerId: CommunicationProviderId): Promise<CommunicationPresence> {
    const provider = this.providers.get(providerId);
    if (!provider?.getPresence) {
      throw new Error("This provider does not support presence.");
    }
    return provider.getPresence();
  }

  async setPresence(input: {
    providerId: CommunicationProviderId;
    status: CommunicationPresenceStatus;
  }): Promise<CommunicationPresence> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.setPresence) {
      throw new Error("This provider does not support presence changes.");
    }
    return provider.setPresence(input.status);
  }

  async setEnabled(input: {
    providerId: CommunicationProviderId;
    enabled: boolean;
  }): Promise<CommunicationPresence> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.setEnabled) {
      throw new Error("This provider does not support availability changes.");
    }
    return provider.setEnabled(input.enabled);
  }

  async sendMessage(input: {
    providerId: CommunicationProviderId;
    conversationId: string;
    text: string;
  }): Promise<CommunicationMessage> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.sendMessage) {
      throw new Error("This conversation does not support sending messages.");
    }
    return provider.sendMessage(input.conversationId, input.text);
  }
}
