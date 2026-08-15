import type {
  CommunicationConversationSummary,
  CommunicationMessage,
  CommunicationNotification,
  CommunicationRoom,
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
  getRoom?(conversationId: string): Promise<CommunicationRoom>;
  getThread?(conversationId: string, parentMessageId: string): Promise<CommunicationMessage[]>;
  sendRoomMessage?(
    conversationId: string,
    text: string,
    parentMessageId?: string | null,
  ): Promise<CommunicationMessage>;
  setReaction?(
    conversationId: string,
    messageId: string,
    emoji: string,
    active: boolean,
  ): Promise<CommunicationMessage>;
}

/**
 * Daemon-global communications projection. A single instance is shared by all
 * sessions so a later provider adapter and its durable state never fork per
 * frontend connection.
 */
export class CommunicationsService {
  private readonly providers = new Map<CommunicationProviderId, CommunicationsProvider>();
  private readonly presenceListeners = new Set<(presence: CommunicationPresence) => void>();
  /** Local acknowledgement only. Never proxy this to a provider read-state API. */
  private readonly dismissedNotificationIds = new Set<string>();

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
    return this.withLocalNotifications(await provider.getHome());
  }

  async acknowledgeNotifications(input: {
    providerId: CommunicationProviderId;
    notificationIds?: readonly string[];
    conversationId?: string;
    clearAll?: boolean;
  }): Promise<CommunicationsInboxHome> {
    const providerHome = await this.requireProviderHome(input.providerId);
    this.markNotificationsDismissed(providerHome, input);
    return this.withLocalNotifications(providerHome);
  }

  private markNotificationsDismissed(
    home: CommunicationsInboxHome,
    input: { notificationIds?: readonly string[]; conversationId?: string; clearAll?: boolean },
  ): void {
    for (const notification of home.notifications ?? deriveNotifications(home)) {
      if (
        input.clearAll ||
        input.notificationIds?.includes(notification.notificationId) ||
        notification.conversation.conversationId === input.conversationId
      ) {
        this.dismissedNotificationIds.add(notification.notificationId);
      }
    }
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

  async getRoom(input: {
    providerId: CommunicationProviderId;
    conversationId: string;
  }): Promise<CommunicationRoom> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.getRoom) throw new Error("This provider does not support chat rooms.");
    const room = await provider.getRoom(input.conversationId);
    // Opening is local acknowledgement only. The provider may expose a true
    // mark-read API, but this room feature does not claim to have called it.
    // A failure acknowledging notifications (e.g. the provider's Home scope
    // was granted after the connection's original token was issued) must
    // never fail the room read it's decorating - the room payload already
    // loaded successfully.
    if (provider.getHome) {
      try {
        await this.acknowledgeNotifications({
          providerId: input.providerId,
          conversationId: input.conversationId,
        });
      } catch (error) {
        console.warn(
          `Communications: failed to acknowledge notifications for '${input.providerId}' after opening room '${input.conversationId}':`,
          error,
        );
      }
    }
    return room;
  }

  async getThread(input: {
    providerId: CommunicationProviderId;
    conversationId: string;
    parentMessageId: string;
  }): Promise<CommunicationMessage[]> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.getThread) throw new Error("This provider does not support reply threads.");
    return provider.getThread(input.conversationId, input.parentMessageId);
  }

  async sendRoomMessage(input: {
    providerId: CommunicationProviderId;
    conversationId: string;
    text: string;
    parentMessageId?: string | null;
  }): Promise<CommunicationMessage> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.sendRoomMessage)
      throw new Error("This provider does not support room messages.");
    return provider.sendRoomMessage(input.conversationId, input.text, input.parentMessageId);
  }

  async setReaction(input: {
    providerId: CommunicationProviderId;
    conversationId: string;
    messageId: string;
    emoji: string;
    active: boolean;
  }): Promise<CommunicationMessage> {
    const provider = this.providers.get(input.providerId);
    if (!provider?.setReaction) throw new Error("This provider does not support reactions.");
    return provider.setReaction(input.conversationId, input.messageId, input.emoji, input.active);
  }

  private async requireProviderHome(
    providerId: CommunicationProviderId,
  ): Promise<CommunicationsInboxHome> {
    const provider = this.providers.get(providerId);
    if (!provider?.getHome) throw new Error("This provider does not support a Chat Home.");
    return provider.getHome();
  }

  private withLocalNotifications(home: CommunicationsInboxHome): CommunicationsInboxHome {
    const providerNotifications = home.notifications ?? deriveNotifications(home);
    return {
      ...home,
      notifications: providerNotifications.filter(
        (notification) => !this.dismissedNotificationIds.has(notification.notificationId),
      ),
    };
  }
}

function deriveNotifications(home: CommunicationsInboxHome): CommunicationNotification[] {
  return home.sections.flatMap((section) =>
    section.conversations
      .filter((conversation) => conversation.unreadCount > 0)
      .map((conversation) => ({
        // Carries the unread-state, not just the conversation identity, so a
        // dismissal only suppresses the state it was raised for: once new
        // unread messages change the count or timestamp, this mints a fresh
        // id that is absent from dismissedNotificationIds and reappears.
        notificationId: `${conversation.providerId}:${conversation.conversationId}:${conversation.unreadCount}:${conversation.updatedAt ?? "unknown"}`,
        conversation,
      })),
  );
}
