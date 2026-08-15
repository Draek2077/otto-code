import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("communications protocol", () => {
  test("accepts a capability-gated overview request and empty response", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.get_overview.request",
        requestId: "communications-overview",
      }),
    ).toMatchObject({ type: "communications.get_overview.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.get_overview.response",
        payload: {
          requestId: "communications-overview",
          overview: { providers: [], conversations: [], unreadCount: 0 },
        },
      }),
    ).toMatchObject({ type: "communications.get_overview.response" });
  });

  test("keeps the communications capability optional for older daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: {},
      }).features?.communications,
    ).toBeUndefined();

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: { communications: true },
      }).features?.communications,
    ).toBe(true);

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: { communicationsChatAvailability: true },
      }).features?.communicationsChatAvailability,
    ).toBe(true);

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: { communicationsChatHome: true },
      }).features?.communicationsChatHome,
    ).toBe(true);

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: { communicationsInboxSearch: true },
      }).features?.communicationsInboxSearch,
    ).toBe(true);

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: { communicationsFavorites: true },
      }).features?.communicationsFavorites,
    ).toBe(true);

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: { communicationsPresenceUpdates: true },
      }).features?.communicationsPresenceUpdates,
    ).toBe(true);

    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: { communicationsRoomNotifications: true },
      }).features?.communicationsRoomNotifications,
    ).toBe(true);
  });

  test("accepts the provider-neutral Chat Home request and collections", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.inbox.get_home.request",
        requestId: "chat-home",
        providerId: "zoom-team-chat",
      }),
    ).toMatchObject({ type: "communications.inbox.get_home.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.inbox.get_home.response",
        payload: {
          requestId: "chat-home",
          home: {
            provider: {
              providerId: "zoom-team-chat",
              label: "Zoom Team Chat",
              connectionState: "connected",
              accountLabel: null,
              error: null,
            },
            sections: [
              {
                id: "shared-spaces",
                label: "Shared spaces",
                conversations: [],
                collections: [
                  {
                    providerId: "zoom-team-chat",
                    collectionId: "space-1",
                    kind: "space",
                    title: "Care coordination",
                    description: null,
                  },
                ],
              },
            ],
          },
        },
      }),
    ).toMatchObject({ type: "communications.inbox.get_home.response" });
  });

  test("accepts a provider-neutral destination search without exposing contact objects", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.inbox.search.request",
        requestId: "chat-search",
        providerId: "zoom-team-chat",
        query: "phi",
      }),
    ).toMatchObject({ type: "communications.inbox.search.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.inbox.search.response",
        payload: {
          requestId: "chat-search",
          results: [
            {
              providerId: "zoom-team-chat",
              category: "person",
              conversation: {
                providerId: "zoom-team-chat",
                conversationId: "contact:philippe%40example.test",
                kind: "direct",
                title: "Philippe Durand",
                preview: null,
                updatedAt: null,
                unreadCount: 0,
                canFavorite: false,
              },
              detail: "philippe@example.test",
              presenceStatus: "available",
              presenceLabel: "Available",
            },
          ],
        },
      }),
    ).toMatchObject({ type: "communications.inbox.search.response" });
  });

  test("accepts a favorite mutation that returns refreshed Chat Home state", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.inbox.set_favorite.request",
        requestId: "favorite-zoom-chat",
        providerId: "zoom-team-chat",
        conversationId: "contact:philippe%40example.test",
        favorite: true,
      }),
    ).toMatchObject({ type: "communications.inbox.set_favorite.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.inbox.set_favorite.response",
        payload: {
          requestId: "favorite-zoom-chat",
          home: {
            provider: {
              providerId: "zoom-team-chat",
              label: "Zoom Team Chat",
              connectionState: "connected",
              accountLabel: null,
              error: null,
            },
            sections: [
              {
                id: "favorites",
                label: "Favorites",
                conversations: [
                  {
                    providerId: "zoom-team-chat",
                    conversationId: "contact:philippe%40example.test",
                    kind: "direct",
                    title: "Philippe Durand",
                    preview: null,
                    updatedAt: null,
                    unreadCount: 0,
                    favorite: true,
                  },
                ],
                collections: [],
              },
            ],
          },
        },
      }),
    ).toMatchObject({ type: "communications.inbox.set_favorite.response" });
  });

  test("accepts daemon-local notification acknowledgement without a provider read claim", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.inbox.notifications.acknowledge.request",
        requestId: "dismiss-zoom-chat",
        providerId: "zoom-team-chat",
        notificationIds: ["zoom-team-chat:channel-1"],
      }),
    ).toMatchObject({ type: "communications.inbox.notifications.acknowledge.request" });
  });

  test("accepts daemon-owned presence reads and changes", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.inbox.set_presence.request",
        requestId: "zoom-presence",
        providerId: "zoom-team-chat",
        status: "do_not_disturb",
      }),
    ).toMatchObject({ type: "communications.inbox.set_presence.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.inbox.get_presence.response",
        payload: {
          requestId: "zoom-presence",
          presence: {
            providerId: "zoom-team-chat",
            status: "available",
            canSetStatus: true,
          },
        },
      }),
    ).toMatchObject({ type: "communications.inbox.get_presence.response" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.inbox.presence.changed.notification",
        payload: {
          presence: {
            providerId: "zoom-team-chat",
            status: "available",
            canSetStatus: true,
            pendingStatus: "available",
            statusChangeAvailableAt: "2026-08-14T12:01:00.000Z",
            statusChangeAvailableInMs: 60_000,
          },
        },
      }),
    ).toMatchObject({ type: "communications.inbox.presence.changed.notification" });
  });

  test("accepts a daemon-owned Chat availability toggle", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.inbox.set_enabled.request",
        requestId: "zoom-chat-enabled",
        providerId: "zoom-team-chat",
        enabled: false,
      }),
    ).toMatchObject({ type: "communications.inbox.set_enabled.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.inbox.set_enabled.response",
        payload: {
          requestId: "zoom-chat-enabled",
          presence: {
            providerId: "zoom-team-chat",
            status: "unknown",
            canSetStatus: true,
            enabled: false,
          },
        },
      }),
    ).toMatchObject({ type: "communications.inbox.set_enabled.response" });
  });

  test("keeps authorization responses metadata-only", () => {
    const parsed = SessionOutboundMessageSchema.parse({
      type: "integrations.authorization.get_overview.response",
      payload: {
        requestId: "authorization-overview",
        overview: {
          vault: { status: "available", backend: "os-keyring" },
          connections: [
            {
              integrationId: "zoom-team-chat",
              connectionId: "primary",
              method: "oauth-pkce",
              state: "connected",
              accountLabel: "otto@example.test",
              grantedScopes: [],
              updatedAt: "2026-08-13T12:00:00.000Z",
              errorCode: null,
              refreshToken: "must-not-survive",
            },
          ],
        },
      },
    });

    expect(parsed.payload).toMatchObject({ requestId: "authorization-overview" });
    expect(parsed.payload.overview.connections[0]).not.toHaveProperty("refreshToken");
  });

  test("accepts additive provider-neutral room, thread, and reaction operations", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "communications.room.message.send.request",
        requestId: "room-send",
        providerId: "zoom-team-chat",
        conversationId: "channel-1",
        parentMessageId: "root-1",
        text: "A real reply",
      }),
    ).toMatchObject({ type: "communications.room.message.send.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "communications.room.get.response",
        payload: {
          requestId: "room-get",
          room: {
            conversation: {
              providerId: "zoom-team-chat",
              conversationId: "channel-1",
              kind: "channel",
              title: "Team",
              preview: null,
              updatedAt: null,
              unreadCount: 0,
            },
            capabilities: {
              canCompose: true,
              canReply: true,
              canRetrieveThreads: true,
              canReact: true,
              canMarkRead: false,
              unavailableReason: null,
            },
            messages: [
              {
                providerId: "zoom-team-chat",
                conversationId: "channel-1",
                messageId: "root-1",
                senderId: "member-1",
                senderDisplayName: "Ada",
                text: "Root",
                sentAt: "2026-08-14T12:00:00.000Z",
                parentMessageId: null,
                replyCount: 1,
                reactions: [{ emoji: "U+1F44D", count: 1, reactedByCurrentUser: true }],
              },
            ],
          },
        },
      }),
    ).toMatchObject({ type: "communications.room.get.response" });
  });

  test("accepts explicit provider-neutral authorization method choices", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "integrations.authorization.get_methods.response",
        payload: {
          requestId: "authorization-methods",
          methods: [
            {
              integrationId: "zoom-team-chat",
              method: "oauth-pkce",
              label: "Sign in with Zoom",
              description: "Connect through Otto's managed Zoom sign-in flow.",
              recommended: true,
              availability: "planned",
            },
          ],
        },
      }),
    ).toMatchObject({ type: "integrations.authorization.get_methods.response" });
  });

  test("accepts a managed Zoom authorization URL without credentials", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "integrations.zoom.start_authorization.request",
        requestId: "zoom-start",
      }),
    ).toMatchObject({ type: "integrations.zoom.start_authorization.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "integrations.zoom.start_authorization.response",
        payload: {
          requestId: "zoom-start",
          authorizationUrl: "https://zoom.us/oauth/authorize?state=opaque",
          error: null,
        },
      }),
    ).toMatchObject({ type: "integrations.zoom.start_authorization.response" });
  });

  test("accepts a provider-neutral browser authorization request without credentials", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "integrations.authorization.start_browser.request",
        requestId: "browser-start",
        integrationId: "zoom-team-chat",
        connectionId: "primary",
      }),
    ).toMatchObject({ type: "integrations.authorization.start_browser.request" });

    expect(
      SessionOutboundMessageSchema.parse({
        type: "integrations.authorization.start_browser.response",
        payload: {
          requestId: "browser-start",
          authorizationUrl: "https://zoom.us/oauth/authorize?state=opaque",
          error: null,
        },
      }),
    ).toMatchObject({ type: "integrations.authorization.start_browser.response" });
  });

  test("keeps the authorization capability optional for older daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({
        status: "server_info",
        serverId: "server",
        features: {},
      }).features?.integrationAuthorization,
    ).toBeUndefined();
  });
});
