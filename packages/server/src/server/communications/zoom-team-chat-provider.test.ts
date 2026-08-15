import { afterEach, describe, expect, test, vi } from "vitest";
import type { CommunicationPresence } from "@otto-code/protocol/communications";
import type { IntegrationConnectionMetadata } from "@otto-code/protocol/integration-authorization";
import type { CredentialVault } from "../integration-authorization/credential-vault.js";
import type { IntegrationAuthorizationRegistry } from "../integration-authorization/integration-authorization-registry.js";
import { IntegrationAuthorizationService } from "../integration-authorization/integration-authorization-service.js";
import {
  ZoomTeamChatProvider,
  ZOOM_TEAM_CHAT_CONNECTION_ID,
  ZOOM_TEAM_CHAT_PROVIDER_ID,
} from "./zoom-team-chat-provider.js";
import { ZoomTeamChatApiError } from "./zoom-team-chat-client.js";
import { ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES } from "./zoom-team-chat-oauth.js";

function createAuthorization(): IntegrationAuthorizationService {
  const records = new Map<string, IntegrationConnectionMetadata>();
  const registry: IntegrationAuthorizationRegistry = {
    initialize: async () => {},
    list: async () => [...records.values()],
    get: async (params) =>
      records.get(JSON.stringify([params.integrationId, params.connectionId])) ?? null,
    upsert: async (record) => {
      records.set(JSON.stringify([record.integrationId, record.connectionId]), record);
    },
    remove: async (params) => {
      records.delete(JSON.stringify([params.integrationId, params.connectionId]));
    },
  };
  const vault: CredentialVault = {
    getAvailability: async () => ({ status: "available", backend: "test" }),
    get: async () => null,
    put: async () => {},
    delete: async () => false,
  };
  return new IntegrationAuthorizationService({
    hostId: "test",
    registry,
    vault,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  });
}

describe("ZoomTeamChatProvider", () => {
  afterEach(() => vi.useRealTimers());
  test("is registered as a disconnected Team Chat provider before OAuth exists", async () => {
    const authorization = createAuthorization();
    const provider = new ZoomTeamChatProvider(authorization);

    await expect(provider.getSummary()).resolves.toEqual({
      providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      label: "Zoom Team Chat",
      connectionState: "disconnected",
      accountLabel: null,
      error: null,
      enabled: false,
    });
    await expect(provider.getConversationSummaries()).resolves.toEqual([]);

    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "authorizing",
    });
    await expect(provider.getSummary()).resolves.toMatchObject({ connectionState: "connecting" });
  });

  test("uses a focused Home sync instead of fetching Zoom for every overview", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({
        items: [
          { id: "dm", name: "Mina", type: "im" },
          { id: "group", name: "Care team", type: "group" },
          { id: "channel", name: "Engineering", type: "channel" },
        ],
      }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.getConversationSummaries()).resolves.toEqual([]);
    await expect(provider.getHome()).resolves.toMatchObject({
      sections: [{ id: "channels", conversations: [{ conversationId: "channel" }] }],
    });
    await expect(provider.getConversationSummaries()).resolves.toMatchObject([
      { conversationId: "channel", unreadCount: 0 },
    ]);
  });

  test("walks the signed-in user's channel pages for the Home list", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async (params) =>
        params?.nextPageToken
          ? { items: [{ id: "second", name: "Second", type: "channel" }] }
          : {
              items: [{ id: "first", name: "First", type: "channel" }],
              nextPageToken: "page-2",
            },
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.getHome()).resolves.toMatchObject({
      sections: [
        {
          id: "channels",
          conversations: [{ conversationId: "first" }, { conversationId: "second" }],
        },
      ],
    });
  });

  test("uses Zoom starred sessions for Favorites and refreshes after a mutation", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
      grantedScopes: ["team_chat:update:chat_control"],
    });
    let favorite = true;
    const setUserChatSessionFavorite = vi.fn(
      async ({ favorite: nextFavorite }: { favorite: boolean }) => {
        favorite = nextFavorite;
      },
    );
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserChatSessions: async () => ({
        items: [
          {
            name: "care@example.test",
            type: "1:1",
            channelId: null,
            peerContactEmail: "care@example.test",
            lastMessageSentTime: "2026-08-13T12:00:00.000Z",
          },
        ],
      }),
      listUserStarredChatSessions: async () => ({
        items: favorite
          ? [
              {
                name: "care@example.test",
                type: "1:1",
                channelId: null,
                peerContactEmail: "care@example.test",
                lastMessageSentTime: null,
              },
            ]
          : [],
      }),
      setUserChatSessionFavorite,
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.getHome()).resolves.toMatchObject({
      sections: [
        {
          id: "favorites",
          conversations: [{ conversationId: "contact:care%40example.test", favorite: true }],
        },
        {
          id: "recent",
          conversations: [{ conversationId: "contact:care%40example.test", favorite: true }],
        },
      ],
    });

    await expect(provider.setFavorite("contact:care%40example.test", false)).resolves.toMatchObject(
      {
        sections: [
          { id: "recent", conversations: [{ conversationId: "contact:care%40example.test" }] },
        ],
      },
    );
    expect(setUserChatSessionFavorite).toHaveBeenCalledWith({
      targetId: "care@example.test",
      targetType: "contact",
      favorite: false,
    });
  });

  test("requires a renewed Zoom grant before changing favorites", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
      grantedScopes: ["team_chat:read:list_user_sessions"],
    });
    const setUserChatSessionFavorite = vi.fn(async () => {});
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
      setUserChatSessionFavorite,
    });

    await expect(provider.setFavorite("channel-id", true)).rejects.toThrow(
      "Reconnect Zoom Chat in Settings",
    );
    expect(setUserChatSessionFavorite).not.toHaveBeenCalled();
  });

  test("omits the signed-in user's non-actionable self chat from Favorites", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
      accountLabel: "philippe@example.test",
      grantedScopes: ["team_chat:update:chat_control"],
    });
    const setUserChatSessionFavorite = vi.fn(async () => {});
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserStarredChatSessions: async () => ({
        items: [
          {
            name: "Philippe Durand (You)",
            type: "1:1",
            channelId: null,
            peerContactEmail: "philippe@example.test",
            lastMessageSentTime: null,
          },
          {
            name: "care@example.test",
            type: "1:1",
            channelId: null,
            peerContactEmail: "care@example.test",
            lastMessageSentTime: null,
          },
        ],
      }),
      listUserChatSessions: async () => ({
        items: [
          {
            name: "Philippe Durand (You)",
            type: "1:1",
            channelId: null,
            peerContactEmail: "philippe@example.test",
            lastMessageSentTime: null,
          },
        ],
      }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
      setUserChatSessionFavorite,
    });

    await expect(provider.getHome()).resolves.toMatchObject({
      sections: [
        {
          id: "favorites",
          conversations: [{ conversationId: "contact:care%40example.test", favorite: true }],
        },
        {
          id: "recent",
          conversations: [
            { conversationId: "contact:philippe%40example.test", canFavorite: false },
          ],
        },
      ],
    });
    await expect(provider.setFavorite("contact:philippe%40example.test", false)).rejects.toThrow(
      "cannot be changed",
    );
    expect(setUserChatSessionFavorite).not.toHaveBeenCalled();
  });

  test("searches people through Zoom and filters the user's channels in the daemon", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
      accountLabel: "philippe@example.test",
    });
    const searchCompanyContacts = vi.fn(async () => ({
      items: [
        {
          displayName: "Philippe Durand",
          email: "philippe@example.test",
          memberId: "member-1",
          presenceStatus: "Available",
        },
      ],
    }));
    const provider = new ZoomTeamChatProvider(authorization, {
      searchCompanyContacts,
      listUserChannels: async () => ({
        items: [
          { id: "engineering", name: "Engineering", type: "channel" },
          { id: "care-team", name: "Care team", type: "group" },
          { id: "dm", name: "Philippe", type: "im" },
        ],
      }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.searchDestinations("phi")).resolves.toEqual([
      {
        providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        category: "person",
        conversation: expect.objectContaining({
          conversationId: "contact:philippe%40example.test",
          kind: "direct",
          title: "Philippe Durand",
          canFavorite: false,
        }),
        detail: "philippe@example.test",
        presenceStatus: "available",
        presenceLabel: "Available",
      },
    ]);
    expect(searchCompanyContacts).toHaveBeenCalledWith({ query: "phi", pageSize: 50 });
  });

  test("searches a full name through Zoom's supported first and last-name terms", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const searchCompanyContacts = vi.fn(async ({ query }: { query: string }) => ({
      items:
        query === "ken"
          ? [
              {
                displayName: "Ken Townly",
                email: "ken.townly@example.test",
                memberId: "member-ken",
                presenceStatus: null,
              },
            ]
          : [],
    }));
    const provider = new ZoomTeamChatProvider(authorization, {
      searchCompanyContacts,
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.searchDestinations("Ken Townly")).resolves.toMatchObject([
      {
        category: "person",
        detail: "ken.townly@example.test",
        conversation: { title: "Ken Townly" },
      },
    ]);
    expect(searchCompanyContacts).toHaveBeenNthCalledWith(1, { query: "ken", pageSize: 50 });
    expect(searchCompanyContacts).toHaveBeenNthCalledWith(2, { query: "townly", pageSize: 50 });
  });

  test("keeps directory search working when Zoom rejects the optional user-contact feed", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      searchCompanyContacts: async () => ({
        items: [
          {
            displayName: "Ken Townly",
            email: "ken.townly@example.test",
            memberId: "member-ken",
            presenceStatus: null,
          },
        ],
      }),
      listUserContacts: async () => {
        throw new ZoomTeamChatApiError(400);
      },
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.searchDestinations("ken")).resolves.toMatchObject([
      {
        category: "person",
        detail: "ken.townly@example.test",
        conversation: { title: "Ken Townly" },
      },
    ]);
  });

  test("includes the signed-in user's Company and External Zoom contacts in people search", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const listUserContacts = vi.fn(async ({ type }: { type: "company" | "external" }) => ({
      items:
        type === "company"
          ? [
              {
                displayName: "Mina Lee",
                email: "mina@example.test",
                memberId: "member-1",
                presenceStatus: null,
              },
            ]
          : [
              {
                displayName: "Carey Miller",
                email: "carey@example.test",
                memberId: "member-2",
                presenceStatus: null,
              },
            ],
    }));
    const provider = new ZoomTeamChatProvider(authorization, {
      searchCompanyContacts: async () => ({ items: [] }),
      listUserContacts,
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.searchDestinations("mina")).resolves.toMatchObject([
      {
        category: "person",
        detail: "mina@example.test",
        conversation: {
          conversationId: "contact:mina%40example.test",
          kind: "direct",
          title: "Mina Lee",
        },
      },
    ]);
    expect(listUserContacts).toHaveBeenNthCalledWith(1, { type: "company", pageSize: 50 });
    expect(listUserContacts).toHaveBeenNthCalledWith(2, { type: "external", pageSize: 50 });
  });

  test("searches matching group and channel destinations without treating direct channels as send targets", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      searchCompanyContacts: async () => ({ items: [] }),
      listUserChannels: async () => ({
        items: [
          { id: "care-team", name: "Care team", type: "group" },
          { id: "care-coordination", name: "Care coordination", type: "channel" },
          { id: "dm", name: "Carey", type: "im" },
        ],
      }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.searchDestinations("care")).resolves.toMatchObject([
      {
        category: "conversation",
        detail: "Group chat",
        conversation: { conversationId: "care-team" },
      },
      {
        category: "conversation",
        detail: "Channel",
        conversation: { conversationId: "care-coordination" },
      },
    ]);
  });

  test("includes Recent chat destinations in search when Zoom omits them from the channel index", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      searchCompanyContacts: async () => ({ items: [] }),
      listUserChannels: async () => ({
        items: [{ id: "testing", name: "Testing", type: "channel" }],
      }),
      listUserChatSessions: async () => ({
        items: [
          {
            name: "Testing",
            type: "groupchat",
            channelId: "testing",
            peerContactEmail: null,
            lastMessageSentTime: "2026-08-13T12:00:00.000Z",
          },
        ],
      }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await provider.getHome();

    await expect(provider.searchDestinations("testing")).resolves.toMatchObject([
      {
        category: "conversation",
        detail: "Group chat",
        conversation: { conversationId: "testing", title: "Testing", kind: "group" },
      },
    ]);
  });

  test("reuses one short-lived daemon channel index across destination queries", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const listUserChannels = vi.fn(async () => ({
      items: [{ id: "care-team", name: "Care team", type: "group" }],
    }));
    const provider = new ZoomTeamChatProvider(authorization, {
      searchCompanyContacts: async () => ({ items: [] }),
      listUserChannels,
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await provider.searchDestinations("ca");
    await provider.searchDestinations("care");

    expect(listUserChannels).toHaveBeenCalledTimes(1);
  });

  test("projects recent chats, channels, and shared spaces into a compact Chat Home", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({
        items: [{ id: "channel-1", name: "Engineering", type: "channel" }],
      }),
      listUserChatSessions: async () => ({
        items: [
          {
            name: "maya@example.test",
            type: "1:1",
            channelId: null,
            peerContactEmail: "maya@example.test",
            lastMessageSentTime: "2026-08-13T12:00:00.000Z",
          },
        ],
      }),
      listSharedSpaces: async () => ({
        items: [{ id: "space-1", name: "Care coordination", description: "Private planning" }],
      }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.getHome()).resolves.toMatchObject({
      provider: { providerId: ZOOM_TEAM_CHAT_PROVIDER_ID, connectionState: "connected" },
      sections: [
        {
          id: "recent",
          conversations: [{ conversationId: "contact:maya%40example.test", kind: "direct" }],
        },
        { id: "channels", conversations: [{ conversationId: "channel-1" }] },
        {
          id: "shared-spaces",
          collections: [{ collectionId: "space-1", kind: "space" }],
        },
      ],
    });
  });

  test("keeps a focused Home usable when one Zoom collection is unavailable", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => {
        throw new Error("Zoom unavailable");
      },
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.getHome()).resolves.toMatchObject({ sections: [] });
  });

  test("reads and sends messages through the daemon-owned channel target", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async ({ channelId, date }) => {
        expect(channelId).toBe("channel-1");
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        return {
          items: [
            {
              id: "message-1",
              message: "A secure update",
              senderId: "user-1",
              timestamp: "2026-08-13T12:00:00.000Z",
            },
          ],
        };
      },
      sendUserMessage: async ({ channelId, message }) => {
        expect(channelId).toBe("channel-1");
        expect(message).toBe("Reply");
        return { id: "message-2" };
      },
    });

    await expect(provider.getMessages("channel-1")).resolves.toEqual([
      {
        providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
        conversationId: "channel-1",
        messageId: "message-1",
        senderId: "user-1",
        text: "A secure update",
        sentAt: "2026-08-13T12:00:00.000Z",
      },
    ]);
    await expect(provider.sendMessage("channel-1", "Reply")).resolves.toMatchObject({
      providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      conversationId: "channel-1",
      messageId: "message-2",
      text: "Reply",
    });
  });

  test("reads messages using the user's local calendar day, not the UTC day", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      let requestedDate: string | undefined;
      const provider = new ZoomTeamChatProvider(
        authorization,
        {
          listUserChannels: async () => ({ items: [] }),
          listUserMessages: async ({ date }) => {
            requestedDate = date;
            return { items: [] };
          },
          sendUserMessage: async () => ({ id: "sent" }),
        },
        // 2026-08-14T03:00:00Z is still 2026-08-13 in America/Los_Angeles (UTC-7 in August).
        { now: () => new Date("2026-08-14T03:00:00.000Z").getTime() },
      );

      await provider.getMessages("channel-1");

      expect(requestedDate).toBe("2026-08-13");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  test("reads and sends a direct session using only its selected contact target", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async ({ contactEmail }) => {
        expect(contactEmail).toBe("maya@example.test");
        return { items: [] };
      },
      sendUserMessage: async ({ contactEmail }) => {
        expect(contactEmail).toBe("maya@example.test");
        return { id: "message-1" };
      },
    });

    await expect(provider.getMessages("contact:maya%40example.test")).resolves.toEqual([]);
    await expect(
      provider.sendMessage("contact:maya%40example.test", "Hello from Otto"),
    ).resolves.toMatchObject({ messageId: "message-1" });
  });

  test("keeps reply parents and reactions attached to provider message identities", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
      grantedScopes: [
        ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.sendUserMessage,
        ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.getMessageThread,
        ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.setMessageReaction,
      ],
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      getCurrentUser: async () => ({ id: "ada", email: "ada@example.test", displayName: "Ada" }),
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({
        items: [
          {
            id: "root-1",
            message: "Root",
            senderId: "ada",
            senderDisplayName: "Ada",
            timestamp: "2026-08-14T12:00:00.000Z",
            reactions: [{ emoji: "U+1F44D", count: 1, isSender: true }],
          },
        ],
      }),
      sendUserMessage: async ({ parentMessageId }) => {
        expect(parentMessageId).toBe("root-1");
        return { id: "reply-1" };
      },
      getMessageThread: async ({ messageId }) => {
        expect(messageId).toBe("root-1");
        return {
          items: [
            {
              id: "reply-1",
              message: "Child",
              senderId: "lin",
              timestamp: "2026-08-14T12:01:00.000Z",
            },
          ],
        };
      },
      setUserMessageReaction: async ({ messageId, emoji, active }) => {
        expect(messageId).toBe("root-1");
        // The neutral provider contract carries a renderer-facing glyph. The
        // Zoom HTTP client alone converts it to Zoom's API identifier.
        expect(emoji).toBe("👍");
        expect(active).toBe(true);
      },
      getUserMessage: async () => ({
        id: "root-1",
        message: "Root",
        senderId: "ada",
        timestamp: "2026-08-14T12:00:00.000Z",
        reactions: [{ emoji: "U+1F44D", count: 2, isSender: true }],
      }),
    });

    await expect(provider.getRoom("channel-1")).resolves.toMatchObject({
      messages: [
        { messageId: "root-1", isFromCurrentUser: true, reactions: [{ emoji: "👍", count: 1 }] },
      ],
      capabilities: { canReply: true, canReact: true },
    });
    await expect(provider.getThread("channel-1", "root-1")).resolves.toMatchObject([
      { messageId: "reply-1", parentMessageId: "root-1", isFromCurrentUser: false },
    ]);
    await expect(provider.sendRoomMessage("channel-1", "Child", "root-1")).resolves.toMatchObject({
      parentMessageId: "root-1",
      isFromCurrentUser: true,
    });
    await expect(provider.setReaction("channel-1", "root-1", "👍", true)).resolves.toMatchObject({
      reactions: [{ emoji: "👍", count: 2 }],
    });
  });

  test("degrades a malformed reaction codepoint to the raw id instead of failing the room load", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({
        items: [
          {
            id: "root-1",
            message: "Root",
            senderId: "ada",
            timestamp: "2026-08-14T12:00:00.000Z",
            // Matches the regex (six hex digits) but exceeds U+10FFFF, so
            // String.fromCodePoint would throw a RangeError.
            reactions: [{ emoji: "U+FFFFFF", count: 1, isSender: false }],
          },
        ],
      }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.getRoom("channel-1")).resolves.toMatchObject({
      messages: [{ messageId: "root-1", reactions: [{ emoji: "U+FFFFFF", count: 1 }] }],
    });
  });

  test("reports canCompose false when the send-message scope was never granted", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
      grantedScopes: [
        ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.getMessageThread,
        ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.setMessageReaction,
      ],
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
    });

    await expect(provider.getRoom("channel-1")).resolves.toMatchObject({
      capabilities: { canCompose: false, canReply: true, canReact: true },
    });
  });

  test("keeps a status pending until Zoom confirms it", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    vi.useFakeTimers();
    let zoomStatus = "Busy";
    const provider = new ZoomTeamChatProvider(
      authorization,
      {
        listUserChannels: async () => ({ items: [] }),
        listUserMessages: async () => ({ items: [] }),
        sendUserMessage: async () => ({ id: "sent" }),
        getPresence: async () => ({ status: zoomStatus }),
        setPresence: async (params) => {
          expect(params).toEqual({ status: "Do_Not_Disturb", duration: 20 });
          zoomStatus = params.status;
        },
      },
      { now: () => Date.parse("2026-08-13T12:00:00.000Z") },
    );

    await expect(provider.getPresence()).resolves.toEqual({
      providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      status: "busy",
      observedStatusLabel: "Busy",
      canSetStatus: true,
      enabled: true,
      statusChangeAvailableAt: null,
      pendingStatus: null,
      statusChangeError: null,
    });
    await expect(provider.setPresence("do_not_disturb")).resolves.toEqual({
      providerId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      status: "busy",
      observedStatusLabel: "Busy",
      canSetStatus: true,
      enabled: true,
      statusChangeAvailableAt: null,
      pendingStatus: "do_not_disturb",
      statusChangeError: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(provider.getPresence()).resolves.toMatchObject({
      status: "do_not_disturb",
      pendingStatus: null,
    });
  });

  test("publishes pending, cooldown, and confirmed presence transitions", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    vi.useFakeTimers();
    let zoomStatus = "Available";
    const provider = new ZoomTeamChatProvider(
      authorization,
      {
        listUserChannels: async () => ({ items: [] }),
        listUserMessages: async () => ({ items: [] }),
        sendUserMessage: async () => ({ id: "sent" }),
        getPresence: async () => ({ status: zoomStatus }),
        setPresence: async (params) => {
          zoomStatus = params.status;
        },
      },
      { now: () => Date.parse("2026-08-13T12:00:00.000Z") },
    );
    await provider.getPresence();
    const updates: CommunicationPresence[] = [];
    provider.subscribePresenceChanges((presence) => updates.push(presence));

    await provider.setPresence("away");
    await vi.advanceTimersByTimeAsync(0);

    expect(updates.some((presence) => presence.pendingStatus === "away")).toBe(true);
    expect(updates.some((presence) => presence.statusChangeAvailableAt !== null)).toBe(true);
    expect(updates[updates.length - 1]).toMatchObject({
      status: "away",
      pendingStatus: null,
      statusChangeAvailableAt: "2026-08-13T12:01:00.000Z",
    });
  });

  test("publishes an authoritative Zoom status change to every frontend", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    let zoomStatus = "Busy";
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
      getPresence: async () => ({ status: zoomStatus }),
    });
    await provider.getPresence();
    const updates: CommunicationPresence[] = [];
    provider.subscribePresenceChanges((presence) => updates.push(presence));

    zoomStatus = "Away";
    await expect(provider.getPresence()).resolves.toMatchObject({ status: "away" });
    expect(updates).toEqual([expect.objectContaining({ status: "away", pendingStatus: null })]);
  });

  test("starts the cooldown when the queued Zoom PUT actually leaves Otto", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    vi.useFakeTimers();
    const queuedAt = Date.parse("2026-08-13T12:00:00.000Z");
    const sentAt = queuedAt + 4_000;
    let now = queuedAt;
    const provider = new ZoomTeamChatProvider(
      authorization,
      {
        listUserChannels: async () => ({ items: [] }),
        listUserMessages: async () => ({ items: [] }),
        sendUserMessage: async () => ({ id: "sent" }),
        getPresence: async () => ({ status: "Busy" }),
        setPresence: async () => {
          now = sentAt;
          return { sentAt };
        },
      },
      { now: () => now },
    );

    await provider.setPresence("away");
    await vi.advanceTimersByTimeAsync(0);

    await expect(provider.getPresence()).resolves.toMatchObject({
      pendingStatus: "away",
      statusChangeAvailableAt: "2026-08-13T12:01:04.000Z",
      statusChangeAvailableInMs: 60_000,
    });
  });

  test("retains the confirmed presence when Zoom returns an unsupported status", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const responses = [{ status: "Available" }, { status: "Offline" }];
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
      getPresence: async () => responses.shift() ?? { status: "Offline" },
    });

    await expect(provider.getPresence()).resolves.toMatchObject({
      status: "available",
      observedStatusLabel: "Available",
    });
    await expect(provider.getPresence()).resolves.toMatchObject({
      status: "available",
      observedStatusLabel: "Offline",
    });
  });

  test("keeps the confirmed presence when Otto Chat is re-enabled", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
      getPresence: async () => ({ status: "Available" }),
    });

    await provider.getPresence();
    await provider.setEnabled(false);
    await expect(provider.setEnabled(true)).resolves.toMatchObject({
      status: "available",
      enabled: true,
    });
  });

  test("retries one desired status at the same one-minute request cadence", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    let requests = 0;
    const provider = new ZoomTeamChatProvider(
      authorization,
      {
        listUserChannels: async () => ({ items: [] }),
        listUserMessages: async () => ({ items: [] }),
        sendUserMessage: async () => ({ id: "sent" }),
        getPresence: async () => ({ status: "Busy" }),
        setPresence: async () => {
          requests += 1;
          throw new Error("Zoom temporarily rejected the update");
        },
      },
      { now: () => Date.now() },
    );

    await expect(provider.setPresence("away")).resolves.toMatchObject({
      pendingStatus: "away",
      statusChangeAvailableAt: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(180_000);
    await expect(provider.getPresence()).resolves.toMatchObject({
      status: "busy",
      pendingStatus: "away",
      statusChangeError: null,
    });
    expect(requests).toBe(4);
  });

  test("keeps only the latest desired status and never sends faster than once a minute", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    const requests: string[] = [];
    const provider = new ZoomTeamChatProvider(
      authorization,
      {
        listUserChannels: async () => ({ items: [] }),
        listUserMessages: async () => ({ items: [] }),
        sendUserMessage: async () => ({ id: "sent" }),
        getPresence: async () => ({ status: "Busy" }),
        setPresence: async ({ status }) => {
          requests.push(status);
        },
      },
      { now: () => Date.now() },
    );

    await provider.setPresence("away");
    await vi.advanceTimersByTimeAsync(0);
    await provider.setPresence("available");
    await provider.setPresence("do_not_disturb");
    await provider.setPresence("available");

    await vi.advanceTimersByTimeAsync(59_999);
    expect(requests).toEqual(["Away"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(requests).toEqual(["Away", "Available"]);
    await expect(provider.getPresence()).resolves.toMatchObject({
      pendingStatus: "available",
      statusChangeAvailableAt: "2026-08-13T12:02:00.000Z",
    });
  });

  test("keeps authorization while disabling Otto Chat for every frontend", async () => {
    const authorization = createAuthorization();
    await authorization.saveConnectionMetadata({
      integrationId: ZOOM_TEAM_CHAT_PROVIDER_ID,
      connectionId: ZOOM_TEAM_CHAT_CONNECTION_ID,
      method: "oauth-pkce",
      state: "connected",
    });
    let getPresenceCalls = 0;
    const provider = new ZoomTeamChatProvider(authorization, {
      listUserChannels: async () => ({ items: [] }),
      listUserMessages: async () => ({ items: [] }),
      sendUserMessage: async () => ({ id: "sent" }),
      getPresence: async () => {
        getPresenceCalls += 1;
        return { status: "Available" };
      },
    });

    await expect(provider.setEnabled(false)).resolves.toMatchObject({ enabled: false });
    await expect(provider.getSummary()).resolves.toMatchObject({
      connectionState: "connected",
      enabled: false,
    });
    await expect(provider.getConversationSummaries()).resolves.toEqual([]);
    await expect(provider.setEnabled(true)).resolves.toMatchObject({
      status: "unknown",
      enabled: true,
    });
    expect(getPresenceCalls).toBe(0);
  });
});
