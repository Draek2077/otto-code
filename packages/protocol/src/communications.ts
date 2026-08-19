import { z } from "zod";

/**
 * Provider-neutral communications vocabulary. Provider adapters translate their
 * native models at this boundary; provider-specific identifiers never escape it.
 *
 * This deliberately describes the read model only. Connection credentials,
 * provider OAuth mechanics, message composition, and notification policy have
 * separate lifecycles and must not leak into the common conversation model.
 */
export const CommunicationProviderIdSchema = z.string().trim().min(1);

export const CommunicationProviderConnectionStateSchema = z.enum([
  "disconnected",
  "connecting",
  "connected",
  "reauth_required",
  "error",
]);

export const CommunicationProviderSummarySchema = z.object({
  providerId: CommunicationProviderIdSchema,
  label: z.string().trim().min(1),
  connectionState: CommunicationProviderConnectionStateSchema,
  accountLabel: z.string().nullable(),
  error: z.string().nullable(),
  /** Otto's daemon-owned availability toggle, distinct from provider OAuth. */
  enabled: z.boolean().optional(),
});

/**
 * Presence is intentionally a small common vocabulary. Providers retain richer
 * client-only states as `unknown` while carrying an optional observed display
 * label where presenting that distinction matters.
 */
export const CommunicationPresenceStatusSchema = z.enum([
  "available",
  "busy",
  "do_not_disturb",
  "away",
  "out_of_office",
  "unknown",
]);

export const CommunicationPresenceSchema = z.object({
  providerId: CommunicationProviderIdSchema,
  status: CommunicationPresenceStatusSchema,
  /**
   * The provider's exact live label when the common vocabulary cannot express
   * it without losing meaning. For example, Zoom's Offline is an observed
   * presence and is not Otto's local Chat disable switch.
   *
   * Optional for old daemons and clients.
   */
  observedStatusLabel: z.string().trim().min(1).nullable().optional(),
  canSetStatus: z.boolean(),
  /** Kept optional so older clients can parse a newer daemon response. */
  enabled: z.boolean().optional(),
  /** Daemon-authoritative earliest time another provider update is permitted. */
  statusChangeAvailableAt: z.string().datetime().nullable().optional(),
  /**
   * Remaining daemon-measured cooldown at the moment this snapshot was sent.
   * Clients count this down locally so remote-daemon clock skew cannot make the
   * visible gate expire before the daemon will send another provider request.
   */
  statusChangeAvailableInMs: z.number().int().nonnegative().nullable().optional(),
  /** A daemon-owned desired status currently being applied to the provider. */
  pendingStatus: CommunicationPresenceStatusSchema.nullable().optional(),
  /** Safe, user-actionable explanation when no status change remains pending. */
  statusChangeError: z.string().trim().min(1).nullable().optional(),
});

/**
 * A provider's conversation categorization, normalized only as far as Otto can
 * present it honestly. Providers with richer topology retain it inside their
 * adapter instead of expanding this shared enum.
 */
export const CommunicationConversationKindSchema = z.enum([
  "direct",
  "group",
  "channel",
  "unknown",
]);

export const CommunicationConversationSummarySchema = z.object({
  providerId: CommunicationProviderIdSchema,
  conversationId: z.string().trim().min(1),
  kind: CommunicationConversationKindSchema,
  title: z.string().trim().min(1),
  preview: z.string().nullable(),
  updatedAt: z.string().datetime().nullable(),
  unreadCount: z.number().int().nonnegative(),
  /** Native provider favorite state. Optional for old daemon payloads. */
  favorite: z.boolean().optional(),
  /** Whether this destination supports a reversible native favorite mutation. */
  canFavorite: z.boolean().optional(),
});

/**
 * A compact, selectable destination returned by a provider's search. The
 * destination is deliberately a conversation summary so choosing either a
 * person or a channel follows the same open/send path without exposing a
 * provider's contact object to the renderer.
 */
export const CommunicationSearchResultSchema = z.object({
  providerId: CommunicationProviderIdSchema,
  category: z.enum(["person", "conversation"]),
  conversation: CommunicationConversationSummarySchema,
  /** A safe disambiguator such as an email address or “Channel”. */
  detail: z.string().trim().min(1).nullable(),
  /** Presence belongs to a searched person, never to a conversation. */
  presenceStatus: CommunicationPresenceStatusSchema.nullable().optional(),
  presenceLabel: z.string().trim().min(1).nullable().optional(),
});

/** A provider-confirmed aggregate attached to one stable message identity. */
export const CommunicationReactionSchema = z.object({
  emoji: z.string().trim().min(1),
  count: z.number().int().nonnegative(),
  reactedByCurrentUser: z.boolean().optional(),
});

/** The message affordances the connected provider can actually honor. */
export const CommunicationRoomCapabilitiesSchema = z.object({
  canCompose: z.boolean(),
  canReply: z.boolean(),
  canRetrieveThreads: z.boolean(),
  canReact: z.boolean(),
  canMarkRead: z.boolean(),
  /** Truthful provider/API limitation, never a daemon-version compatibility message. */
  unavailableReason: z.string().trim().min(1).nullable(),
});

/**
 * A room message has a stable provider identity and an explicit parent link.
 * Renderers must never infer thread topology from chronology or indentation.
 */
export const CommunicationMessageSchema = z.object({
  providerId: CommunicationProviderIdSchema,
  conversationId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
  senderId: z.string().trim().min(1).nullable(),
  text: z.string(),
  sentAt: z.string().datetime().nullable(),
  /** Optional additions keep old daemon payloads readable. */
  senderDisplayName: z.string().trim().min(1).nullable().optional(),
  /** Explicit provider-confirmed authorship. Never infer this from timeline order. */
  isFromCurrentUser: z.boolean().optional(),
  parentMessageId: z.string().trim().min(1).nullable().optional(),
  replyCount: z.number().int().nonnegative().optional(),
  reactions: z.array(CommunicationReactionSchema).optional(),
});

/** The durable room read model shared by popup and workspace-tab surfaces. */
export const CommunicationRoomSchema = z.object({
  conversation: CommunicationConversationSummarySchema,
  messages: z.array(CommunicationMessageSchema),
  capabilities: CommunicationRoomCapabilitiesSchema,
});

/**
 * A non-message grouping a provider exposes in its home surface, such as a
 * shared space or a future provider's folder. It is intentionally not
 * selectable as a conversation: an adapter must explicitly expose its child
 * conversations before Otto can open it.
 */
export const CommunicationHomeCollectionSchema = z.object({
  providerId: CommunicationProviderIdSchema,
  collectionId: z.string().trim().min(1),
  kind: z.enum(["space", "folder", "unknown"]),
  title: z.string().trim().min(1),
  description: z.string().nullable(),
});

export const CommunicationHomeSectionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  conversations: z.array(CommunicationConversationSummarySchema),
  collections: z.array(CommunicationHomeCollectionSchema),
});

/**
 * A local Otto notification. Acknowledging it only changes Otto's inbox
 * projection; it is not evidence that a provider message was marked read.
 */
export const CommunicationNotificationSchema = z.object({
  notificationId: z.string().trim().min(1),
  conversation: CommunicationConversationSummarySchema,
});

/** A provider-owned, deliberately compact home surface for its chat topology. */
export const CommunicationsInboxHomeSchema = z.object({
  provider: CommunicationProviderSummarySchema,
  sections: z.array(CommunicationHomeSectionSchema),
  /** Optional so clients and daemons spanning the room feature stay compatible. */
  notifications: z.array(CommunicationNotificationSchema).optional(),
});

/**
 * The small projection used by a title-bar inbox. The daemon owns this
 * projection and may return an empty list before any provider is connected.
 */
export const CommunicationsOverviewSchema = z.object({
  providers: z.array(CommunicationProviderSummarySchema),
  conversations: z.array(CommunicationConversationSummarySchema),
  unreadCount: z.number().int().nonnegative(),
});

export type CommunicationProviderId = z.infer<typeof CommunicationProviderIdSchema>;
export type CommunicationProviderConnectionState = z.infer<
  typeof CommunicationProviderConnectionStateSchema
>;
export type CommunicationProviderSummary = z.infer<typeof CommunicationProviderSummarySchema>;
export type CommunicationPresenceStatus = z.infer<typeof CommunicationPresenceStatusSchema>;
export type CommunicationPresence = z.infer<typeof CommunicationPresenceSchema>;
export type CommunicationConversationKind = z.infer<typeof CommunicationConversationKindSchema>;
export type CommunicationConversationSummary = z.infer<
  typeof CommunicationConversationSummarySchema
>;
export type CommunicationSearchResult = z.infer<typeof CommunicationSearchResultSchema>;
export type CommunicationReaction = z.infer<typeof CommunicationReactionSchema>;
export type CommunicationRoomCapabilities = z.infer<typeof CommunicationRoomCapabilitiesSchema>;
export type CommunicationMessage = z.infer<typeof CommunicationMessageSchema>;
export type CommunicationRoom = z.infer<typeof CommunicationRoomSchema>;
export type CommunicationHomeCollection = z.infer<typeof CommunicationHomeCollectionSchema>;
export type CommunicationHomeSection = z.infer<typeof CommunicationHomeSectionSchema>;
export type CommunicationNotification = z.infer<typeof CommunicationNotificationSchema>;
export type CommunicationsInboxHome = z.infer<typeof CommunicationsInboxHomeSchema>;
export type CommunicationsOverview = z.infer<typeof CommunicationsOverviewSchema>;

// Communications is a daemon-owned, provider-neutral integration family. The
// first contract intentionally exposes only a compact read projection; OAuth,
// message send, and provider-specific controls arrive only after the Zoom proof
// demonstrates that this boundary is reliable. Gated by features.communications.
export const CommunicationsGetOverviewRequestSchema = z.object({
  type: z.literal("communications.get_overview.request"),
  requestId: z.string(),
});

export const CommunicationsGetOverviewResponseSchema = z.object({
  type: z.literal("communications.get_overview.response"),
  payload: z.object({
    overview: CommunicationsOverviewSchema,
    requestId: z.string(),
  }),
});

export type CommunicationsGetOverviewRequest = z.infer<
  typeof CommunicationsGetOverviewRequestSchema
>;
export type CommunicationsGetOverviewResponse = z.infer<
  typeof CommunicationsGetOverviewResponseSchema
>;

// A connected provider's title-bar home is more detailed than the global
// overview and is independently capability-gated by communicationsChatHome.
export const CommunicationsInboxGetHomeRequestSchema = z.object({
  type: z.literal("communications.inbox.get_home.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
});

export const CommunicationsInboxGetHomeResponseSchema = z.object({
  type: z.literal("communications.inbox.get_home.response"),
  payload: z.object({
    home: CommunicationsInboxHomeSchema,
    requestId: z.string(),
  }),
});

export type CommunicationsInboxGetHomeRequest = z.infer<
  typeof CommunicationsInboxGetHomeRequestSchema
>;
export type CommunicationsInboxGetHomeResponse = z.infer<
  typeof CommunicationsInboxGetHomeResponseSchema
>;

// COMPAT(communicationsInboxSearch): added in v0.8.11, remove gate after
// 2027-02-15. Destination search is a new capability and newer clients must
// not issue this request to older hosts.
export const CommunicationsInboxSearchRequestSchema = z.object({
  type: z.literal("communications.inbox.search.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  query: z.string().trim().min(2).max(100),
});

export const CommunicationsInboxSearchResponseSchema = z.object({
  type: z.literal("communications.inbox.search.response"),
  payload: z.object({
    results: z.array(CommunicationSearchResultSchema),
    requestId: z.string(),
  }),
});

export type CommunicationsInboxSearchRequest = z.infer<
  typeof CommunicationsInboxSearchRequestSchema
>;
export type CommunicationsInboxSearchResponse = z.infer<
  typeof CommunicationsInboxSearchResponseSchema
>;

// COMPAT(communicationsFavorites): added in v0.8.11, remove gate after
// 2027-02-15. A host without provider-native favorite mutations must not
// receive this request from a newer frontend.
export const CommunicationsInboxSetFavoriteRequestSchema = z.object({
  type: z.literal("communications.inbox.set_favorite.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  favorite: z.boolean(),
});

export const CommunicationsInboxSetFavoriteResponseSchema = z.object({
  type: z.literal("communications.inbox.set_favorite.response"),
  payload: z.object({
    // Return fresh daemon-owned Home state, not renderer-local toggle intent.
    home: CommunicationsInboxHomeSchema,
    requestId: z.string(),
  }),
});

export type CommunicationsInboxSetFavoriteResponse = z.infer<
  typeof CommunicationsInboxSetFavoriteResponseSchema
>;

// COMPAT(communicationsRoomNotifications): added in v0.8.11, remove gate after
// 2027-02-15. Acknowledgement is daemon-local and must not be sent to old hosts.
export const CommunicationsInboxNotificationsAcknowledgeRequestSchema = z.object({
  type: z.literal("communications.inbox.notifications.acknowledge.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  notificationIds: z.array(z.string().trim().min(1)).optional(),
  conversationId: z.string().trim().min(1).optional(),
  clearAll: z.boolean().optional(),
});

export const CommunicationsInboxNotificationsAcknowledgeResponseSchema = z.object({
  type: z.literal("communications.inbox.notifications.acknowledge.response"),
  payload: z.object({ home: CommunicationsInboxHomeSchema, requestId: z.string() }),
});

export type CommunicationsInboxNotificationsAcknowledgeResponse = z.infer<
  typeof CommunicationsInboxNotificationsAcknowledgeResponseSchema
>;

export const CommunicationsInboxGetPresenceRequestSchema = z.object({
  type: z.literal("communications.inbox.get_presence.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
});

export const CommunicationsInboxGetPresenceResponseSchema = z.object({
  type: z.literal("communications.inbox.get_presence.response"),
  payload: z.object({ presence: CommunicationPresenceSchema, requestId: z.string() }),
});

// COMPAT(communicationsPresenceUpdates): added in v0.8.11, remove gate after
// 2027-02-14. The daemon publishes the authoritative status queue and cooldown
// state to capable frontends, so an open popup never has to be closed and
// reopened to observe a retry, completion, or failure.
export const CommunicationsInboxPresenceChangedNotificationSchema = z.object({
  type: z.literal("communications.inbox.presence.changed.notification"),
  payload: z.object({ presence: CommunicationPresenceSchema }),
});

export const CommunicationsInboxSetPresenceRequestSchema = z.object({
  type: z.literal("communications.inbox.set_presence.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  status: CommunicationPresenceStatusSchema,
});

export const CommunicationsInboxSetPresenceResponseSchema = z.object({
  type: z.literal("communications.inbox.set_presence.response"),
  payload: z.object({ presence: CommunicationPresenceSchema, requestId: z.string() }),
});

// The Chat availability toggle is separate from provider presence: disabling
// Otto Chat must not discard the user's provider authorization or impersonate
// an unsupported native presence value. Gated by communicationsChatAvailability.
export const CommunicationsInboxSetEnabledRequestSchema = z.object({
  type: z.literal("communications.inbox.set_enabled.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  enabled: z.boolean(),
});

export const CommunicationsInboxSetEnabledResponseSchema = z.object({
  type: z.literal("communications.inbox.set_enabled.response"),
  payload: z.object({ presence: CommunicationPresenceSchema, requestId: z.string() }),
});

export type CommunicationsInboxGetPresenceResponse = z.infer<
  typeof CommunicationsInboxGetPresenceResponseSchema
>;
export type CommunicationsInboxPresenceChangedNotification = z.infer<
  typeof CommunicationsInboxPresenceChangedNotificationSchema
>;
export type CommunicationsInboxSetPresenceResponse = z.infer<
  typeof CommunicationsInboxSetPresenceResponseSchema
>;
export type CommunicationsInboxSetEnabledResponse = z.infer<
  typeof CommunicationsInboxSetEnabledResponseSchema
>;

export const CommunicationsInboxGetMessagesRequestSchema = z.object({
  type: z.literal("communications.inbox.get_messages.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
});

export const CommunicationsInboxGetMessagesResponseSchema = z.object({
  type: z.literal("communications.inbox.get_messages.response"),
  payload: z.object({
    messages: z.array(CommunicationMessageSchema),
    requestId: z.string(),
  }),
});

export const CommunicationsInboxSendMessageRequestSchema = z.object({
  type: z.literal("communications.inbox.send_message.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

export const CommunicationsInboxSendMessageResponseSchema = z.object({
  type: z.literal("communications.inbox.send_message.response"),
  payload: z.object({
    message: CommunicationMessageSchema,
    requestId: z.string(),
  }),
});

export type CommunicationsInboxGetMessagesRequest = z.infer<
  typeof CommunicationsInboxGetMessagesRequestSchema
>;
export type CommunicationsInboxGetMessagesResponse = z.infer<
  typeof CommunicationsInboxGetMessagesResponseSchema
>;
export type CommunicationsInboxSendMessageRequest = z.infer<
  typeof CommunicationsInboxSendMessageRequestSchema
>;
export type CommunicationsInboxSendMessageResponse = z.infer<
  typeof CommunicationsInboxSendMessageResponseSchema
>;

// COMPAT(communicationsRooms): added in v0.8.11, remove gate after 2027-02-15.
// Room operations are deliberately a separate, provider-neutral surface. Older
// hosts must never receive them from newer popup or workspace-tab renderers.
export const CommunicationsRoomGetRequestSchema = z.object({
  type: z.literal("communications.room.get.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
});

export const CommunicationsRoomGetResponseSchema = z.object({
  type: z.literal("communications.room.get.response"),
  payload: z.object({ room: CommunicationRoomSchema, requestId: z.string() }),
});

export const CommunicationsRoomThreadGetRequestSchema = z.object({
  type: z.literal("communications.room.thread.get.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  parentMessageId: z.string().trim().min(1),
});

export const CommunicationsRoomThreadGetResponseSchema = z.object({
  type: z.literal("communications.room.thread.get.response"),
  payload: z.object({ messages: z.array(CommunicationMessageSchema), requestId: z.string() }),
});

export const CommunicationsRoomMessageSendRequestSchema = z.object({
  type: z.literal("communications.room.message.send.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  text: z.string().trim().min(1),
  parentMessageId: z.string().trim().min(1).nullable().optional(),
});

export const CommunicationsRoomMessageSendResponseSchema = z.object({
  type: z.literal("communications.room.message.send.response"),
  payload: z.object({ message: CommunicationMessageSchema, requestId: z.string() }),
});

export const CommunicationsRoomReactionSetRequestSchema = z.object({
  type: z.literal("communications.room.reaction.set.request"),
  requestId: z.string(),
  providerId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
  emoji: z.string().trim().min(1),
  active: z.boolean(),
});

export const CommunicationsRoomReactionSetResponseSchema = z.object({
  type: z.literal("communications.room.reaction.set.response"),
  payload: z.object({ message: CommunicationMessageSchema, requestId: z.string() }),
});

export type CommunicationsRoomGetResponse = z.infer<typeof CommunicationsRoomGetResponseSchema>;
export type CommunicationsRoomThreadGetResponse = z.infer<
  typeof CommunicationsRoomThreadGetResponseSchema
>;
export type CommunicationsRoomMessageSendResponse = z.infer<
  typeof CommunicationsRoomMessageSendResponseSchema
>;
export type CommunicationsRoomReactionSetResponse = z.infer<
  typeof CommunicationsRoomReactionSetResponseSchema
>;
