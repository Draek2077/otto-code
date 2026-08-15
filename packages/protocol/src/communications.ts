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

/** A message deliberately contains only the display data Otto can render. */
export const CommunicationMessageSchema = z.object({
  providerId: CommunicationProviderIdSchema,
  conversationId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
  senderId: z.string().trim().min(1).nullable(),
  text: z.string(),
  sentAt: z.string().datetime().nullable(),
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

/** A provider-owned, deliberately compact home surface for its chat topology. */
export const CommunicationsInboxHomeSchema = z.object({
  provider: CommunicationProviderSummarySchema,
  sections: z.array(CommunicationHomeSectionSchema),
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
export type CommunicationMessage = z.infer<typeof CommunicationMessageSchema>;
export type CommunicationHomeCollection = z.infer<typeof CommunicationHomeCollectionSchema>;
export type CommunicationHomeSection = z.infer<typeof CommunicationHomeSectionSchema>;
export type CommunicationsInboxHome = z.infer<typeof CommunicationsInboxHomeSchema>;
export type CommunicationsOverview = z.infer<typeof CommunicationsOverviewSchema>;
