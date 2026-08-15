import type {
  CommunicationConversationSummary,
  CommunicationHomeCollection,
  CommunicationHomeSection,
  CommunicationMessage,
  CommunicationReaction,
  CommunicationRoom,
  CommunicationRoomCapabilities,
  CommunicationPresence,
  CommunicationPresenceStatus,
  CommunicationProviderSummary,
  CommunicationSearchResult,
  CommunicationsInboxHome,
} from "@otto-code/protocol/communications";
import type { IntegrationAuthorizationMethodOption } from "@otto-code/protocol/integration-authorization";
import type { CommunicationsProvider } from "./communications-service.js";
import { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import {
  ZoomTeamChatClient,
  ZoomTeamChatApiError,
  type ZoomTeamChatChannel,
  type ZoomTeamChatContact,
  type ZoomTeamChatCurrentUser,
  type ZoomTeamChatMessage,
  type ZoomTeamChatSession,
  type ZoomTeamChatSharedSpace,
  type ZoomTeamChatUserContactType,
} from "./zoom-team-chat-client.js";
import { ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES } from "./zoom-team-chat-oauth.js";
import { createZoomTeamChatAccessTokenSupplier } from "./zoom-team-chat-token-supplier.js";

/** Stable provider identity for Zoom Team Chat, distinct from meeting capture. */
export const ZOOM_TEAM_CHAT_PROVIDER_ID = "zoom-team-chat";
export const ZOOM_TEAM_CHAT_CONNECTION_ID = "primary";
const CHAT_HOME_CACHE_TTL_MS = 30_000;
const CHAT_SEARCH_CACHE_TTL_MS = 30_000;
const CHAT_SEARCH_RESULT_LIMIT = 6;
const ZOOM_PRESENCE_CHANGE_INTERVAL_MS = 60_000;
const ZOOM_PRESENCE_CONFIRMATION_POLL_INTERVAL_MS = 2_000;

interface CachedZoomTeamChatHome {
  home: CommunicationsInboxHome;
  cachedAt: number;
}

interface CachedZoomTeamChatSearch {
  results: CommunicationSearchResult[];
  cachedAt: number;
}

interface CachedZoomTeamChatChannels {
  channels: ZoomTeamChatChannel[];
  cachedAt: number;
}

interface CachedZoomTeamChatContacts {
  contacts: ZoomTeamChatContact[];
  cachedAt: number;
}

/** Otto-managed browser sign-in is Zoom Team Chat's only supported connection path. */
export const ZOOM_TEAM_CHAT_AUTHORIZATION_METHODS: readonly IntegrationAuthorizationMethodOption[] =
  [
    {
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      method: "oauth-pkce",
      label: "Sign in with Zoom",
      description: "Recommended. Connect through Otto's managed Zoom sign-in flow.",
      recommended: true,
      availability: "available",
    },
  ];

export function getZoomTeamChatAuthorizationMethods(): readonly IntegrationAuthorizationMethodOption[] {
  return ZOOM_TEAM_CHAT_AUTHORIZATION_METHODS;
}

interface ZoomTeamChatChannelReader {
  getCurrentUser?(): Promise<ZoomTeamChatCurrentUser>;
  listUserChannels(params?: { nextPageToken?: string }): Promise<{
    items: ZoomTeamChatChannel[];
    nextPageToken?: string | null;
  }>;
  listUserMessages(params: {
    channelId?: string;
    contactEmail?: string;
    date: string;
  }): Promise<{ items: ZoomTeamChatMessage[] }>;
  sendUserMessage(params: {
    channelId?: string;
    contactEmail?: string;
    message: string;
    parentMessageId?: string | null;
  }): Promise<{ id: string }>;
  getUserMessage?(params: {
    channelId?: string;
    contactEmail?: string;
    messageId: string;
  }): Promise<ZoomTeamChatMessage>;
  getMessageThread?(params: {
    channelId?: string;
    contactEmail?: string;
    messageId: string;
    from: string;
  }): Promise<{ items: ZoomTeamChatMessage[] }>;
  setUserMessageReaction?(params: {
    channelId?: string;
    contactEmail?: string;
    messageId: string;
    emoji: string;
    active: boolean;
  }): Promise<void>;
  searchCompanyContacts?(params: {
    query: string;
    pageSize?: number;
    nextPageToken?: string;
  }): Promise<{
    items: ZoomTeamChatContact[];
    nextPageToken?: string | null;
  }>;
  listUserContacts?(params: {
    type: ZoomTeamChatUserContactType;
    pageSize?: number;
    nextPageToken?: string;
  }): Promise<{
    items: ZoomTeamChatContact[];
    nextPageToken?: string | null;
  }>;
  listUserChatSessions?(params: {
    from: string;
    to: string;
    nextPageToken?: string;
  }): Promise<{ items: ZoomTeamChatSession[]; nextPageToken?: string | null }>;
  listUserStarredChatSessions?(params?: {
    nextPageToken?: string;
  }): Promise<{ items: ZoomTeamChatSession[]; nextPageToken?: string | null }>;
  setUserChatSessionFavorite?(params: {
    targetId: string;
    targetType: "channel" | "contact";
    favorite: boolean;
  }): Promise<void>;
  listSharedSpaces?(params?: { nextPageToken?: string }): Promise<{
    items: ZoomTeamChatSharedSpace[];
    nextPageToken?: string | null;
  }>;
  getPresence?(): Promise<{ status: string }>;
  setPresence?(params: { status: string; duration?: number }): Promise<void | { sentAt: number }>;
}

/**
 * Zoom proof adapter. It is deliberately disconnected until daemon-grade secret
 * storage and the OAuth callback design are both in place. Do not add tokens to
 * daemon config as a shortcut: this adapter is the boundary that keeps Zoom
 * credentials out of session messages and renderer state.
 */
export class ZoomTeamChatProvider implements CommunicationsProvider {
  readonly id = ZOOM_TEAM_CHAT_PROVIDER_ID;
  private cachedHome: CachedZoomTeamChatHome | null = null;
  private cachedSearchChannels: CachedZoomTeamChatChannels | null = null;
  private cachedSearchContacts: CachedZoomTeamChatContacts | null = null;
  private readonly searchCache = new Map<string, CachedZoomTeamChatSearch>();
  private homeRequest: Promise<CommunicationsInboxHome> | null = null;
  private nextStatusChangeAt: number | null = null;
  private desiredPresenceStatus: CommunicationPresenceStatus | null = null;
  private presenceControllerTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceControllerRunning = false;
  private lastKnownPresenceStatus: CommunicationPresenceStatus = "unknown";
  private lastObservedPresenceLabel: string | null = null;
  private lastPresenceChangeError: string | null = null;
  private readonly presenceListeners = new Set<(presence: CommunicationPresence) => void>();
  private readonly now: () => number;
  private cachedCurrentUser: { accountLabel: string | null; id: string } | null = null;

  constructor(
    private readonly authorization: IntegrationAuthorizationService,
    private readonly channels: ZoomTeamChatChannelReader = new ZoomTeamChatClient(
      createZoomTeamChatAccessTokenSupplier(authorization),
    ),
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  subscribePresenceChanges(listener: (presence: CommunicationPresence) => void): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  async getSummary(): Promise<CommunicationProviderSummary> {
    const connection = await this.authorization.getConnection({
      integrationId: this.id,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
    });
    return {
      providerId: this.id,
      label: "Zoom Team Chat",
      connectionState: connection
        ? toCommunicationConnectionState(connection.state)
        : "disconnected",
      accountLabel: connection?.accountLabel ?? null,
      error: connection?.errorCode ?? null,
      enabled: connection?.state === "connected" && connection.enabled !== false,
    };
  }

  async getConversationSummaries(): Promise<CommunicationConversationSummary[]> {
    const connection = await this.authorization.getConnection({
      integrationId: this.id,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
    });
    if (connection?.state !== "connected" || connection.enabled === false) {
      return [];
    }
    // The lightweight title-bar overview must not itself contact Zoom. A
    // focused popup owns the bounded Home sync below, whose result is shared
    // with every connected frontend for a short period.
    return this.getCachedConversations();
  }

  async getHome(): Promise<CommunicationsInboxHome> {
    const connection = await this.requireConnected();
    const provider = await this.getSummary();
    if (connection.enabled === false) return { provider, sections: [] };
    if (this.cachedHome && Date.now() - this.cachedHome.cachedAt < CHAT_HOME_CACHE_TTL_MS) {
      return this.cachedHome.home;
    }
    if (this.homeRequest) return this.homeRequest;

    const request = this.loadHome(provider, toNormalizedEmail(connection.accountLabel));
    this.homeRequest = request;
    try {
      const home = await request;
      this.cachedHome = { home, cachedAt: Date.now() };
      return home;
    } finally {
      if (this.homeRequest === request) this.homeRequest = null;
    }
  }

  async searchDestinations(query: string): Promise<CommunicationSearchResult[]> {
    const connection = await this.requireConnected();
    const signedInEmail = toNormalizedEmail(connection.accountLabel);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (normalizedQuery.length < 2) return [];
    const cached = this.searchCache.get(normalizedQuery);
    if (cached && this.now() - cached.cachedAt < CHAT_SEARCH_CACHE_TTL_MS) {
      return cached.results;
    }

    // Zoom supplies a real company-contact lookup, while channel discovery is
    // only a user's own channel list. Keep those two vendor mechanics inside
    // the adapter and expose one provider-neutral destination list outward.
    const [companyContacts, userContacts] = await Promise.all([
      this.searchCompanyContacts(normalizedQuery),
      this.getSearchableUserContacts(),
    ]);
    const channels = await this.getSearchableChannels();
    const favoriteConversationIds = this.getFavoriteConversationIds();
    const peopleResults = uniqueContacts([...userContacts, ...companyContacts])
      .filter((contact) => matchesContactSearch(contact, normalizedQuery))
      .filter((contact) => Boolean(contact.email || contact.memberId))
      .slice(0, CHAT_SEARCH_RESULT_LIMIT)
      .map((contact) => toPersonSearchResult(contact, favoriteConversationIds, signedInEmail));
    const channelResults = channels
      .filter((channel) => {
        const kind = toConversationKind(channel.type);
        return kind === "group" || kind === "channel";
      })
      .filter((channel) => matchesSearch(channel.name, normalizedQuery))
      .map((channel) => toConversationSearchResult(channel, favoriteConversationIds));
    const conversationResults = uniqueConversationSearchResults([
      ...this.getCachedRecentSearchResults(normalizedQuery),
      ...channelResults,
    ]).slice(0, CHAT_SEARCH_RESULT_LIMIT);
    const results = [...peopleResults, ...conversationResults];
    this.searchCache.set(normalizedQuery, { results, cachedAt: this.now() });
    return results;
  }

  async setFavorite(conversationId: string, favorite: boolean): Promise<CommunicationsInboxHome> {
    const connection = await this.requireConnected();
    if (connection.enabled === false || !this.channels.setUserChatSessionFavorite) {
      throw new Error("This Zoom connection cannot update favorites.");
    }
    if (!connection.grantedScopes.includes(ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.setFavorite)) {
      throw new Error("Reconnect Zoom Chat in Settings to allow favorites.");
    }
    if (isSignedInUsersConversation(conversationId, toNormalizedEmail(connection.accountLabel))) {
      throw new Error("Your own Zoom chat cannot be changed as a favorite.");
    }
    const target = toZoomFavoriteTarget(conversationId);
    if (!target) throw new Error("This Zoom chat destination cannot be favorited.");
    await this.channels.setUserChatSessionFavorite({ ...target, favorite });
    // Zoom owns the state. Evict all derived projections and return a fresh
    // Home snapshot after its mutation rather than toggling a renderer-local bit.
    this.cachedHome = null;
    this.searchCache.clear();
    return this.getHome();
  }

  private async loadHome(
    provider: CommunicationProviderSummary,
    signedInEmail: string | null,
  ): Promise<CommunicationsInboxHome> {
    // These are intentionally sequential. Zoom rate limits Team Chat at the
    // account level, so the former Promise.all burst made opening a popup
    // reject an otherwise-valid new connection with HTTP 429.
    const favorites = await this.listFavoriteSessions().catch(() => []);
    const sessions = await this.listRecentSessions().catch(() => []);
    const channels = await this.getSearchableChannels().catch(() => []);
    const sharedSpaces = await this.listAllSharedSpaces().catch(() => []);

    // Zoom surfaces a non-actionable self conversation in its native Starred
    // view. It cannot be unstarred, so showing it in Otto would create a star
    // control that cannot honor its removal affordance. The OAuth account
    // label is resolved from `/users/me` during sign-in and supplies the
    // stable email needed to omit only that entry.
    const favoriteConversations = favorites
      .filter((session) => !isSignedInUsersDirectSession(session, signedInEmail))
      .flatMap(toFavoriteConversation);
    const favoriteConversationIds = new Set(
      favoriteConversations.map((conversation) => conversation.conversationId),
    );
    const recent = sessions
      .flatMap(toRecentConversation)
      .map((conversation) => withFavorite(conversation, favoriteConversationIds))
      .map((conversation) => withFavoriteEligibility(conversation, signedInEmail));
    const channelConversations = channels
      .filter((channel) => toConversationKind(channel.type) === "channel")
      .map(toChannelConversation)
      .map((conversation) => withFavorite(conversation, favoriteConversationIds));
    const sections: CommunicationHomeSection[] = [
      {
        id: "favorites",
        label: "Favorites",
        conversations: favoriteConversations,
        collections: [],
      },
      { id: "recent", label: "Recent", conversations: recent, collections: [] },
      { id: "channels", label: "Channels", conversations: channelConversations, collections: [] },
      {
        id: "shared-spaces",
        label: "Shared spaces",
        conversations: [],
        collections: sharedSpaces.map(toSharedSpaceCollection),
      },
    ].filter((section) => section.conversations.length > 0 || section.collections.length > 0);

    return { provider, sections };
  }

  async getPresence(): Promise<CommunicationPresence> {
    const connection = await this.requireConnected();
    if (connection.enabled === false) {
      return this.createPresence({ status: "unknown", canSetStatus: true, enabled: false });
    }
    if (!this.channels.getPresence) {
      return this.createPresence({ status: "unknown", canSetStatus: false, enabled: true });
    }
    const observedStatus = this.observeZoomPresence(await this.channels.getPresence());
    return this.createPresence({
      status: observedStatus === "unknown" ? this.lastKnownPresenceStatus : observedStatus,
      canSetStatus: true,
      enabled: true,
    });
  }

  async setPresence(status: CommunicationPresenceStatus): Promise<CommunicationPresence> {
    await this.requireConnected();
    const zoomStatus = toZoomPresenceStatus(status);
    if (!zoomStatus || !this.channels.setPresence || !this.channels.getPresence) {
      throw new Error("This Zoom presence status cannot be changed from Otto.");
    }
    this.desiredPresenceStatus = status;
    this.lastPresenceChangeError = null;
    this.schedulePresenceController();
    const result = this.createPresence({
      status: this.lastKnownPresenceStatus,
      canSetStatus: true,
      enabled: true,
    });
    this.emitPresenceChanged(result);
    return result;
  }

  async setEnabled(enabled: boolean): Promise<CommunicationPresence> {
    await this.requireConnected();
    await this.authorization.setConnectionEnabled({
      integrationId: this.id,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      enabled,
    });
    if (!enabled) {
      this.desiredPresenceStatus = null;
      this.clearPresenceControllerTimer();
      const result = this.createPresence({ status: "unknown", canSetStatus: true, enabled: false });
      this.emitPresenceChanged(result);
      return result;
    }
    // Enabling is Otto-local. Do not make it contingent on a fresh Zoom
    // presence read, which can be temporarily rate-limited immediately after
    // authorization. The next normal refresh will replace unknown with
    // Zoom's authoritative status.
    const result = this.createPresence({
      status: this.lastKnownPresenceStatus,
      canSetStatus: true,
      enabled: true,
    });
    this.emitPresenceChanged(result);
    return result;
  }

  async getMessages(conversationId: string): Promise<CommunicationMessage[]> {
    const connection = await this.requireConnected();
    const contactEmail = getContactEmail(conversationId);
    const [messages, currentUserId] = await Promise.all([
      this.channels.listUserMessages({
        ...(contactEmail ? { contactEmail } : { channelId: conversationId }),
        date: toLocalDateString(new Date(this.now())),
      }),
      this.getCurrentUserId(connection.accountLabel),
    ]);
    return messages.items.map((message) =>
      toCommunicationMessage(this.id, conversationId, message, currentUserId),
    );
  }

  async sendMessage(conversationId: string, text: string): Promise<CommunicationMessage> {
    await this.requireConnected();
    const contactEmail = getContactEmail(conversationId);
    const sent = await this.channels.sendUserMessage({
      ...(contactEmail ? { contactEmail } : { channelId: conversationId }),
      message: text,
    });
    return {
      providerId: this.id,
      conversationId,
      messageId: sent.id,
      senderId: null,
      isFromCurrentUser: true,
      text,
      sentAt: new Date().toISOString(),
    };
  }

  async getRoom(conversationId: string): Promise<CommunicationRoom> {
    const connection = await this.requireConnected();
    const [messages, conversation] = await Promise.all([
      this.getMessages(conversationId),
      this.getConversationSummary(conversationId),
    ]);
    return {
      conversation,
      // A normal room timeline deliberately contains only top-level messages.
      // Thread children are read by the provider-confirmed thread operation.
      messages: messages.filter((message) => !message.parentMessageId),
      capabilities: this.getRoomCapabilities(connection.grantedScopes),
    };
  }

  async getThread(
    conversationId: string,
    parentMessageId: string,
  ): Promise<CommunicationMessage[]> {
    const connection = await this.requireConnected();
    if (!this.channels.getMessageThread) {
      throw new Error("Zoom's current API connection cannot retrieve reply threads.");
    }
    requireGrantedScope(
      connection.grantedScopes,
      ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.getMessageThread,
    );
    const target = toZoomMessageTarget(conversationId);
    // Zoom's documented `from` format is `yyyy-MM-dd'T'HH:mm:ss'Z'`, with no
    // milliseconds. `Date#toISOString` always includes them, which is why
    // every prior attempt failed regardless of value or span. `to` is
    // optional and defaults to the current time, so it is omitted here.
    const sixMonthsAgo = new Date(this.now());
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const [thread, currentUserId] = await Promise.all([
      this.channels.getMessageThread({
        ...target,
        messageId: parentMessageId,
        from: toZoomTimestamp(sixMonthsAgo),
      }),
      this.getCurrentUserId(connection.accountLabel),
    ]);
    return thread.items
      .filter((message) => message.id !== parentMessageId)
      .map((message) => {
        const translated = toCommunicationMessage(this.id, conversationId, message, currentUserId);
        translated.parentMessageId ??= parentMessageId;
        return translated;
      });
  }

  async sendRoomMessage(
    conversationId: string,
    text: string,
    parentMessageId?: string | null,
  ): Promise<CommunicationMessage> {
    const connection = await this.requireConnected();
    requireGrantedScope(
      connection.grantedScopes,
      ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.sendUserMessage,
    );
    if (parentMessageId) {
      requireGrantedScope(
        connection.grantedScopes,
        ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.getMessageThread,
      );
    }
    const sent = await this.channels.sendUserMessage({
      ...toZoomMessageTarget(conversationId),
      message: text,
      ...(parentMessageId ? { parentMessageId } : {}),
    });
    return {
      providerId: this.id,
      conversationId,
      messageId: sent.id,
      senderId: null,
      isFromCurrentUser: true,
      text,
      sentAt: new Date().toISOString(),
      ...(parentMessageId ? { parentMessageId } : {}),
      reactions: [],
    };
  }

  async setReaction(
    conversationId: string,
    messageId: string,
    emoji: string,
    active: boolean,
  ): Promise<CommunicationMessage> {
    const connection = await this.requireConnected();
    if (!this.channels.setUserMessageReaction || !this.channels.getUserMessage) {
      throw new Error("Zoom's current API connection cannot update reactions.");
    }
    requireGrantedScope(
      connection.grantedScopes,
      ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.setMessageReaction,
    );
    const target = toZoomMessageTarget(conversationId);
    await this.channels.setUserMessageReaction({ ...target, messageId, emoji, active });
    const message = await this.channels.getUserMessage({ ...target, messageId });
    return toCommunicationMessage(
      this.id,
      conversationId,
      message,
      await this.getCurrentUserId(connection.accountLabel),
    );
  }

  private async getCurrentUserId(accountLabel: string | null): Promise<string | null> {
    if (this.cachedCurrentUser?.accountLabel === accountLabel) {
      return this.cachedCurrentUser.id;
    }
    // Authorship only controls local speech affordances. A transient /users/me
    // failure must not prevent the room timeline itself from loading. Only a
    // successful lookup is cached, so a transient failure is retried on the
    // next call instead of being remembered as "no current user" forever.
    const currentUser = this.channels.getCurrentUser
      ? await this.channels.getCurrentUser().catch(() => null)
      : null;
    if (!currentUser?.id) return null;
    this.cachedCurrentUser = { accountLabel, id: currentUser.id };
    return currentUser.id;
  }

  private getRoomCapabilities(grantedScopes: readonly string[]): CommunicationRoomCapabilities {
    const canCompose = grantedScopes.includes(
      ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.sendUserMessage,
    );
    const canReply = grantedScopes.includes(
      ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.getMessageThread,
    );
    const canReact = grantedScopes.includes(
      ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.setMessageReaction,
    );
    return {
      canCompose,
      canReply,
      canRetrieveThreads: canReply,
      canReact,
      // Notifications are an Otto-local acknowledgement until the inbox has a
      // concrete provider message identity and invokes Zoom's mark-read API.
      canMarkRead: false,
      unavailableReason:
        canCompose && canReply && canReact
          ? null
          : "Reconnect Zoom Chat in Settings to enable sending, reply threads, and reactions.",
    };
  }

  private async getConversationSummary(
    conversationId: string,
  ): Promise<CommunicationConversationSummary> {
    const cached = this.getCachedConversations().find(
      (conversation) => conversation.conversationId === conversationId,
    );
    if (cached) return cached;
    return {
      providerId: this.id,
      conversationId,
      kind: getContactEmail(conversationId) ? "direct" : "unknown",
      title: getContactEmail(conversationId) ?? "Zoom chat",
      preview: null,
      updatedAt: null,
      unreadCount: 0,
    };
  }

  private async requireConnected() {
    const connection = await this.authorization.getConnection({
      integrationId: this.id,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
    });
    if (connection?.state !== "connected") {
      throw new Error("Zoom Team Chat is not connected.");
    }
    return connection;
  }

  private async listAllUserChannels(): Promise<ZoomTeamChatChannel[]> {
    const channels: ZoomTeamChatChannel[] = [];
    const seen = new Set<string>();
    let nextPageToken: string | null | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await this.channels.listUserChannels(
        nextPageToken ? { nextPageToken } : undefined,
      );
      for (const channel of result.items) {
        if (!seen.has(channel.id)) {
          seen.add(channel.id);
          channels.push(channel);
        }
      }
      nextPageToken = result.nextPageToken;
      if (!nextPageToken) break;
    }
    return channels;
  }

  private async getSearchableChannels(): Promise<ZoomTeamChatChannel[]> {
    if (
      this.cachedSearchChannels &&
      this.now() - this.cachedSearchChannels.cachedAt < CHAT_SEARCH_CACHE_TTL_MS
    ) {
      return this.cachedSearchChannels.channels;
    }
    const channels = await this.listAllUserChannels();
    this.cachedSearchChannels = { channels, cachedAt: this.now() };
    return channels;
  }

  private getCachedRecentSearchResults(normalizedQuery: string): CommunicationSearchResult[] {
    // A recent session is a valid chat destination, but Zoom does not guarantee it also
    // appears in the user's channel list. Reuse the Home sync instead of adding another
    // request for every keystroke.
    const recent = this.cachedHome?.home.sections.find((section) => section.id === "recent");
    return (recent?.conversations ?? [])
      .filter((conversation) => matchesSearch(conversation.title, normalizedQuery))
      .map(toConversationSummarySearchResult);
  }

  private getFavoriteConversationIds(): ReadonlySet<string> {
    return new Set(
      this.cachedHome?.home.sections
        .find((section) => section.id === "favorites")
        ?.conversations.map((conversation) => conversation.conversationId) ?? [],
    );
  }

  private async searchCompanyContacts(normalizedQuery: string): Promise<ZoomTeamChatContact[]> {
    if (!this.channels.searchCompanyContacts) {
      throw new Error("This Zoom connection cannot search people.");
    }
    const contacts: ZoomTeamChatContact[] = [];
    // Zoom's directory endpoint only accepts one first name, last name, or
    // email. Split a full-name query into those supported lookup terms, then
    // apply the user's complete query locally before presenting a result.
    for (const query of toZoomContactSearchTerms(normalizedQuery)) {
      const result = await this.channels.searchCompanyContacts({ query, pageSize: 50 });
      contacts.push(...result.items);
    }
    return uniqueContacts(contacts);
  }

  private async getSearchableUserContacts(): Promise<ZoomTeamChatContact[]> {
    if (
      this.cachedSearchContacts &&
      this.now() - this.cachedSearchContacts.cachedAt < CHAT_SEARCH_CACHE_TTL_MS
    ) {
      return this.cachedSearchContacts.contacts;
    }
    if (!this.channels.listUserContacts) return [];

    // The account directory and the signed-in user's Zoom contacts are
    // distinct, administrator-controlled feeds. Read both Company and
    // External contact lists alongside the fast directory lookup, then cache
    // their compact index across the popup's debounced searches.
    try {
      const contacts: ZoomTeamChatContact[] = [];
      for (const type of ["company", "external"] as const) {
        let nextPageToken: string | null | undefined;
        for (let page = 0; page < 2; page += 1) {
          const result = await this.channels.listUserContacts({
            type,
            pageSize: 50,
            ...(nextPageToken ? { nextPageToken } : {}),
          });
          contacts.push(...result.items);
          nextPageToken = result.nextPageToken;
          if (!nextPageToken) break;
        }
      }
      const cached = { contacts: uniqueContacts(contacts), cachedAt: this.now() };
      this.cachedSearchContacts = cached;
      return cached.contacts;
    } catch (error) {
      // This endpoint is documented for user-managed OAuth apps. Some Zoom
      // enterprise app registrations reject it even after reauthorization;
      // preserve the account-directory search instead of failing all people
      // results when that optional feed is unavailable.
      if (!(error instanceof ZoomTeamChatApiError) || ![400, 403].includes(error.status)) {
        throw error;
      }
      const cached = { contacts: [], cachedAt: this.now() };
      this.cachedSearchContacts = cached;
      return cached.contacts;
    }
  }

  private async listRecentSessions(): Promise<ZoomTeamChatSession[]> {
    if (!this.channels.listUserChatSessions) return [];
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return this.listAllPages((nextPageToken) =>
      this.channels.listUserChatSessions!({
        from: from.toISOString(),
        to: now.toISOString(),
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    );
  }

  private async listFavoriteSessions(): Promise<ZoomTeamChatSession[]> {
    if (!this.channels.listUserStarredChatSessions) return [];
    return this.listAllPages((nextPageToken) =>
      this.channels.listUserStarredChatSessions!(nextPageToken ? { nextPageToken } : undefined),
    );
  }

  private async listAllSharedSpaces(): Promise<ZoomTeamChatSharedSpace[]> {
    if (!this.channels.listSharedSpaces) return [];
    return this.listAllPages((nextPageToken) =>
      this.channels.listSharedSpaces!(nextPageToken ? { nextPageToken } : undefined),
    );
  }

  private async listAllPages<T>(
    getPage: (nextPageToken?: string) => Promise<{
      items: T[];
      nextPageToken?: string | null;
    }>,
  ): Promise<T[]> {
    const items: T[] = [];
    let nextPageToken: string | null | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await getPage(nextPageToken ?? undefined);
      items.push(...result.items);
      nextPageToken = result.nextPageToken;
      if (!nextPageToken) break;
    }
    return items;
  }

  private getCachedConversations(): CommunicationConversationSummary[] {
    return this.cachedHome?.home.sections.flatMap((section) => section.conversations) ?? [];
  }

  private schedulePresenceController(): void {
    this.clearPresenceControllerTimer();
    if (!this.desiredPresenceStatus) return;

    const now = this.now();
    const nextRunAt =
      this.nextStatusChangeAt && now < this.nextStatusChangeAt
        ? Math.min(this.nextStatusChangeAt, now + ZOOM_PRESENCE_CONFIRMATION_POLL_INTERVAL_MS)
        : now;
    this.presenceControllerTimer = setTimeout(
      () => {
        this.presenceControllerTimer = null;
        void this.runPresenceController();
      },
      Math.max(0, nextRunAt - now),
    );
  }

  private clearPresenceControllerTimer(): void {
    if (!this.presenceControllerTimer) return;
    clearTimeout(this.presenceControllerTimer);
    this.presenceControllerTimer = null;
  }

  /**
   * There is exactly one controller and exactly one vendor cadence. A new
   * selection replaces the desired state; it never creates another request or
   * another timer. The next PUT is therefore both the retry and the latest
   * user intent.
   */
  private async runPresenceController(): Promise<void> {
    if (this.presenceControllerRunning || !this.desiredPresenceStatus) return;
    this.presenceControllerRunning = true;
    try {
      if (this.nextStatusChangeAt && this.now() < this.nextStatusChangeAt) {
        await this.pollZoomPresence();
        return;
      }
      await this.sendDesiredPresence();
    } finally {
      this.presenceControllerRunning = false;
      this.schedulePresenceController();
    }
  }

  private async sendDesiredPresence(): Promise<void> {
    const desiredStatus = this.desiredPresenceStatus;
    if (!desiredStatus || !this.channels.setPresence) return;

    const zoomStatus = toZoomPresenceStatus(desiredStatus);
    if (!zoomStatus) {
      this.desiredPresenceStatus = null;
      this.lastPresenceChangeError = "This Zoom presence status cannot be changed from Otto.";
      this.emitPresenceChanged(this.createConnectedPresence());
      return;
    }

    let requestSentAt: number | null = null;
    try {
      const update = await this.channels.setPresence({
        status: zoomStatus,
        ...(zoomStatus === "Do_Not_Disturb" ? { duration: 20 } : {}),
      });
      requestSentAt = getZoomPresenceUpdateSentAt(update) ?? this.now();
    } catch (error) {
      requestSentAt =
        error instanceof ZoomTeamChatApiError && error.sentAt !== null ? error.sentAt : this.now();
      this.lastPresenceChangeError = describeZoomPresenceChangeError(error);
    }

    // This timestamp is the only cadence gate. It starts when a request has
    // actually left Otto, including a non-2xx response from Zoom. A transport
    // failure with no observable send time is conservatively treated the same
    // way to avoid a hot retry loop.
    this.nextStatusChangeAt = requestSentAt + ZOOM_PRESENCE_CHANGE_INTERVAL_MS;
    this.emitPresenceChanged(this.createConnectedPresence());
    await this.pollZoomPresence();
  }

  private async pollZoomPresence(): Promise<void> {
    if (!this.channels.getPresence || !this.desiredPresenceStatus) return;
    try {
      this.observeZoomPresence(await this.channels.getPresence());
    } catch {
      // Keep the desired status and use the same cadence gate for the next
      // confirmation poll or retry. Do not retain provider response content.
    }
  }

  private observeZoomPresence(presence: { status: string }): CommunicationPresenceStatus {
    const previousStatus = this.lastKnownPresenceStatus;
    const previousLabel = this.lastObservedPresenceLabel;
    const observedStatus = toCommunicationPresenceStatus(presence.status);
    this.lastObservedPresenceLabel = toZoomPresenceLabel(presence.status);
    if (observedStatus !== "unknown") this.lastKnownPresenceStatus = observedStatus;
    let confirmed = false;
    if (
      this.desiredPresenceStatus &&
      observedStatus !== "unknown" &&
      observedStatus === this.desiredPresenceStatus
    ) {
      this.desiredPresenceStatus = null;
      this.lastPresenceChangeError = null;
      this.clearPresenceControllerTimer();
      confirmed = true;
    }
    if (
      confirmed ||
      previousStatus !== this.lastKnownPresenceStatus ||
      previousLabel !== this.lastObservedPresenceLabel
    ) {
      this.emitPresenceChanged(this.createConnectedPresence());
    }
    return observedStatus;
  }

  private createConnectedPresence(): CommunicationPresence {
    return this.createPresence({
      status: this.lastKnownPresenceStatus,
      canSetStatus: true,
      enabled: true,
    });
  }

  private emitPresenceChanged(presence: CommunicationPresence): void {
    for (const listener of this.presenceListeners) listener(presence);
  }

  private createPresence(params: {
    status: CommunicationPresenceStatus;
    canSetStatus: boolean;
    enabled: boolean;
  }): CommunicationPresence {
    const statusChangeAvailableAt =
      this.nextStatusChangeAt && this.now() < this.nextStatusChangeAt
        ? this.nextStatusChangeAt
        : null;
    const statusChangeAvailableInMs = statusChangeAvailableAt
      ? Math.max(0, statusChangeAvailableAt - this.now())
      : null;
    return {
      providerId: this.id,
      ...params,
      ...(this.lastObservedPresenceLabel
        ? { observedStatusLabel: this.lastObservedPresenceLabel }
        : {}),
      statusChangeAvailableAt: statusChangeAvailableAt
        ? new Date(statusChangeAvailableAt).toISOString()
        : null,
      ...(statusChangeAvailableInMs === null ? {} : { statusChangeAvailableInMs }),
      pendingStatus: this.desiredPresenceStatus,
      statusChangeError: this.desiredPresenceStatus ? null : this.lastPresenceChangeError,
    };
  }
}

function toChannelConversation(channel: ZoomTeamChatChannel): CommunicationConversationSummary {
  return {
    providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
    conversationId: channel.id,
    kind: toConversationKind(channel.type),
    title: channel.name ?? "Zoom channel",
    preview: null,
    updatedAt: null,
    unreadCount: 0,
  };
}

function toPersonSearchResult(
  contact: ZoomTeamChatContact,
  favoriteConversationIds: ReadonlySet<string>,
  signedInEmail: string | null,
): CommunicationSearchResult {
  const target = contact.email ?? contact.memberId;
  const presenceStatus = contact.presenceStatus
    ? toCommunicationPresenceStatus(contact.presenceStatus)
    : "unknown";
  return {
    providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
    category: "person",
    conversation: withFavoriteEligibility(
      withFavorite(
        {
          providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
          conversationId: `contact:${encodeURIComponent(target ?? contact.displayName ?? "unknown")}`,
          kind: "direct",
          title: contact.displayName ?? contact.email ?? "Zoom contact",
          preview: null,
          updatedAt: null,
          unreadCount: 0,
        },
        favoriteConversationIds,
      ),
      signedInEmail,
    ),
    detail: contact.email ?? null,
    presenceStatus: presenceStatus === "unknown" ? null : presenceStatus,
    presenceLabel: contact.presenceStatus ? toZoomPresenceLabel(contact.presenceStatus) : null,
  };
}

function toConversationSearchResult(
  channel: ZoomTeamChatChannel,
  favoriteConversationIds: ReadonlySet<string>,
): CommunicationSearchResult {
  return toConversationSummarySearchResult(
    withFavorite(toChannelConversation(channel), favoriteConversationIds),
  );
}

function toConversationSummarySearchResult(
  conversation: CommunicationConversationSummary,
): CommunicationSearchResult {
  return {
    providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
    category: "conversation",
    conversation,
    detail: conversationSearchDetail(conversation.kind),
    presenceStatus: null,
    presenceLabel: null,
  };
}

function conversationSearchDetail(
  kind: CommunicationConversationSummary["kind"],
): "Channel" | "Group chat" | "Direct message" {
  switch (kind) {
    case "channel":
      return "Channel";
    case "group":
      return "Group chat";
    default:
      return "Direct message";
  }
}

function uniqueConversationSearchResults(
  results: CommunicationSearchResult[],
): CommunicationSearchResult[] {
  const seenConversationIds = new Set<string>();
  return results.filter((result) => {
    const { conversationId } = result.conversation;
    if (seenConversationIds.has(conversationId)) return false;
    seenConversationIds.add(conversationId);
    return true;
  });
}

function matchesSearch(value: string | null, normalizedQuery: string): boolean {
  return value?.toLocaleLowerCase().includes(normalizedQuery) ?? false;
}

function matchesContactSearch(contact: ZoomTeamChatContact, normalizedQuery: string): boolean {
  return [contact.displayName, contact.email, contact.memberId]
    .filter((value): value is string => Boolean(value))
    .some((value) => matchesSearch(value, normalizedQuery));
}

function toZoomContactSearchTerms(normalizedQuery: string): string[] {
  if (normalizedQuery.includes("@")) return [normalizedQuery];
  return [...new Set(normalizedQuery.split(/\s+/).filter(Boolean))];
}

function uniqueContacts(contacts: readonly ZoomTeamChatContact[]): ZoomTeamChatContact[] {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const identity = contact.email ?? contact.memberId;
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function toNormalizedEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLocaleLowerCase();
  return normalized?.includes("@") ? normalized : null;
}

function isSignedInUsersDirectSession(
  session: ZoomTeamChatSession,
  signedInEmail: string | null,
): boolean {
  return (
    session.type === "1:1" &&
    signedInEmail !== null &&
    toNormalizedEmail(session.peerContactEmail) === signedInEmail
  );
}

function isSignedInUsersConversation(
  conversationId: string,
  signedInEmail: string | null,
): boolean {
  return (
    signedInEmail !== null && toNormalizedEmail(getContactEmail(conversationId)) === signedInEmail
  );
}

function toRecentConversation(session: ZoomTeamChatSession): CommunicationConversationSummary[] {
  if (session.type === "groupchat" && session.channelId) {
    return [
      {
        providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        conversationId: session.channelId,
        kind: "group",
        title: session.name,
        preview: null,
        updatedAt: session.lastMessageSentTime,
        unreadCount: 0,
      },
    ];
  }
  const contactTarget = session.peerContactEmail ?? session.peerContactMemberId;
  if (session.type === "1:1" && contactTarget) {
    return [
      {
        providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        conversationId: `contact:${encodeURIComponent(contactTarget)}`,
        kind: "direct",
        title: session.name,
        preview: null,
        updatedAt: session.lastMessageSentTime,
        unreadCount: 0,
      },
    ];
  }
  return [];
}

function toFavoriteConversation(session: ZoomTeamChatSession): CommunicationConversationSummary[] {
  const conversations = toRecentConversation(session);
  for (const conversation of conversations) conversation.favorite = true;
  return conversations;
}

function withFavorite(
  conversation: CommunicationConversationSummary,
  favoriteConversationIds: ReadonlySet<string>,
): CommunicationConversationSummary {
  return favoriteConversationIds.has(conversation.conversationId)
    ? { ...conversation, favorite: true }
    : conversation;
}

function withFavoriteEligibility(
  conversation: CommunicationConversationSummary,
  signedInEmail: string | null,
): CommunicationConversationSummary {
  return isSignedInUsersConversation(conversation.conversationId, signedInEmail)
    ? { ...conversation, canFavorite: false }
    : conversation;
}

function toSharedSpaceCollection(space: ZoomTeamChatSharedSpace): CommunicationHomeCollection {
  return {
    providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
    collectionId: space.id,
    kind: "space",
    title: space.name,
    description: space.description,
  };
}

function getContactEmail(conversationId: string): string | null {
  if (!conversationId.startsWith("contact:")) return null;
  const encodedEmail = conversationId.slice("contact:".length);
  try {
    return encodedEmail ? decodeURIComponent(encodedEmail) : null;
  } catch {
    return null;
  }
}

/** The user's local calendar day, not the UTC day `toISOString` would give. */
function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Zoom's documented thread `from`/`to` format: `yyyy-MM-dd'T'HH:mm:ss'Z'`, no milliseconds. */
function toZoomTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function toZoomMessageTarget(conversationId: string): {
  channelId?: string;
  contactEmail?: string;
} {
  const contactEmail = getContactEmail(conversationId);
  return contactEmail ? { contactEmail } : { channelId: conversationId };
}

function toCommunicationMessage(
  providerId: string,
  conversationId: string,
  message: ZoomTeamChatMessage,
  currentUserId: string | null = null,
): CommunicationMessage {
  const reactions: CommunicationReaction[] = (message.reactions ?? []).map((reaction) => ({
    emoji: fromZoomEmojiId(reaction.emoji),
    count: reaction.count,
    reactedByCurrentUser: reaction.isSender,
  }));
  return {
    providerId,
    conversationId,
    messageId: message.id,
    senderId: message.senderId,
    text: message.message,
    sentAt: message.timestamp,
    ...(message.senderDisplayName ? { senderDisplayName: message.senderDisplayName } : {}),
    ...(currentUserId && message.senderId
      ? { isFromCurrentUser: message.senderId === currentUserId }
      : {}),
    ...(message.parentMessageId ? { parentMessageId: message.parentMessageId } : {}),
    ...(reactions.length > 0 ? { reactions } : {}),
  };
}

function fromZoomEmojiId(emoji: string): string {
  const parts = emoji.split(/[_-]/);
  if (!parts.length || !parts.every((part) => /^U\+[0-9A-F]{1,6}$/i.test(part))) {
    return emoji;
  }
  try {
    return String.fromCodePoint(
      ...parts.map((part) => Number.parseInt(part.slice(2), 16)).filter(Number.isFinite),
    );
  } catch {
    // A malformed codepoint above U+10FFFF (matched by the regex above, which
    // allows any 6 hex digits) must degrade to the raw id, not fail the whole
    // room load over one bad reaction.
    return emoji;
  }
}

function requireGrantedScope(grantedScopes: readonly string[], scope: string): void {
  if (!grantedScopes.includes(scope)) {
    throw new Error("Reconnect Zoom Chat in Settings to enable this room action.");
  }
}

function toZoomFavoriteTarget(
  conversationId: string,
): { targetId: string; targetType: "channel" | "contact" } | null {
  const contactEmail = getContactEmail(conversationId);
  if (contactEmail) return { targetId: contactEmail, targetType: "contact" };
  return conversationId ? { targetId: conversationId, targetType: "channel" } : null;
}

function toCommunicationPresenceStatus(status: string): CommunicationPresenceStatus {
  switch (status) {
    case "Available":
      return "available";
    case "Busy":
      return "busy";
    case "Do_Not_Disturb":
      return "do_not_disturb";
    case "Away":
      return "away";
    case "Out_of_Office":
      return "out_of_office";
    case "In_Calendar_Event":
    case "In_A_Calendar_Event":
    case "Presenting":
    case "In_A_Zoom_Meeting":
    case "In_A_Meeting":
    case "On_A_Call":
    case "In_A_Call":
      return "busy";
    default:
      return "unknown";
  }
}

function toZoomPresenceLabel(status: string): string | null {
  switch (status) {
    case "Available":
      return "Available";
    case "Busy":
      return "Busy";
    case "Do_Not_Disturb":
      return "Do not disturb";
    case "Away":
      return "Away";
    case "Out_of_Office":
      return "Out of office";
    case "In_Calendar_Event":
    case "In_A_Calendar_Event":
      return "In a calendar event";
    case "Presenting":
      return "Presenting";
    case "In_A_Zoom_Meeting":
    case "In_A_Meeting":
      return "In a Zoom meeting";
    case "On_A_Call":
    case "In_A_Call":
      return "On a call";
    case "Offline":
      return "Offline";
    default:
      return null;
  }
}

function describeZoomPresenceChangeError(error: unknown): string {
  if (error instanceof ZoomTeamChatApiError) {
    return `Zoom rejected the status update (HTTP ${error.status}).`;
  }
  return "Zoom did not accept the status update.";
}

function getZoomPresenceUpdateSentAt(update: void | { sentAt: number }): number | null {
  return typeof update?.sentAt === "number" && Number.isFinite(update.sentAt)
    ? update.sentAt
    : null;
}

function toZoomPresenceStatus(status: CommunicationPresenceStatus): string | null {
  switch (status) {
    case "available":
      return "Available";
    case "busy":
      return "Busy";
    case "do_not_disturb":
      return "Do_Not_Disturb";
    case "away":
      return "Away";
    case "out_of_office":
      return "Out_of_Office";
    case "unknown":
      return null;
  }
}

function toConversationKind(
  zoomChannelType: string | null,
): CommunicationConversationSummary["kind"] {
  switch (zoomChannelType) {
    case "im":
      return "direct";
    case "group":
      return "group";
    case "channel":
      return "channel";
    default:
      return "unknown";
  }
}

function toCommunicationConnectionState(
  state: "disconnected" | "authorizing" | "connected" | "reauth_required" | "error",
): CommunicationProviderSummary["connectionState"] {
  return state === "authorizing" ? "connecting" : state;
}
