import { describe, expect, test } from "vitest";
import type {
  CommunicationConversationSummary,
  CommunicationPresence,
} from "@otto-code/protocol/communications";
import { CommunicationsService, type CommunicationsProvider } from "./communications-service.js";

function createProvider(
  overrides: { conversations?: CommunicationConversationSummary[] } = {},
): CommunicationsProvider {
  const conversations = overrides.conversations ?? [
    {
      providerId: "zoom",
      conversationId: "older",
      kind: "direct",
      title: "Ada",
      preview: "Earlier message",
      updatedAt: "2026-08-13T12:00:00.000Z",
      unreadCount: 1,
    },
    {
      providerId: "zoom",
      conversationId: "newer",
      kind: "channel",
      title: "Otto",
      preview: null,
      updatedAt: "2026-08-13T12:01:00.000Z",
      unreadCount: 2,
    },
  ];
  return {
    id: "zoom",
    async getSummary() {
      return {
        providerId: "zoom",
        label: "Zoom Team Chat",
        connectionState: "connected",
        accountLabel: "otto@example.test",
        error: null,
      };
    },
    async getConversationSummaries() {
      return conversations;
    },
  };
}

describe("CommunicationsService", () => {
  test("starts empty before a provider is connected", async () => {
    await expect(new CommunicationsService().getOverview()).resolves.toEqual({
      providers: [],
      conversations: [],
      unreadCount: 0,
    });
  });

  test("projects and sorts a registered provider's conversations", async () => {
    const service = new CommunicationsService();
    service.registerProvider(createProvider());

    await expect(service.getOverview()).resolves.toMatchObject({
      unreadCount: 3,
      providers: [{ providerId: "zoom", connectionState: "connected" }],
      conversations: [{ conversationId: "newer" }, { conversationId: "older" }],
    });
  });

  test("does not allow two adapters to own one provider id", () => {
    const service = new CommunicationsService();
    service.registerProvider(createProvider());

    expect(() => service.registerProvider(createProvider())).toThrow("already registered");
  });

  test("fans a provider presence transition out to every subscriber", () => {
    let emit: ((presence: CommunicationPresence) => void) | null = null;
    const service = new CommunicationsService();
    service.registerProvider({
      ...createProvider(),
      subscribePresenceChanges(listener) {
        emit = listener;
        return () => {
          emit = null;
        };
      },
    });
    const updates: Array<{ status: string; pendingStatus: string | null }> = [];
    service.subscribePresenceChanges((presence) => {
      updates.push({ status: presence.status, pendingStatus: presence.pendingStatus ?? null });
    });

    emit?.({
      providerId: "zoom",
      status: "busy",
      canSetStatus: true,
      pendingStatus: "away",
    });

    expect(updates).toEqual([{ status: "busy", pendingStatus: "away" }]);
  });

  function createNotifiableProvider(conversations: CommunicationConversationSummary[]) {
    return {
      ...createProvider({ conversations }),
      async getHome() {
        return {
          provider: await this.getSummary(),
          sections: [
            {
              id: "recent",
              label: "Recent",
              conversations: await this.getConversationSummaries(),
              collections: [],
            },
          ],
        };
      },
      async getRoom(conversationId: string) {
        return {
          conversation: (await this.getConversationSummaries()).find(
            (conversation) => conversation.conversationId === conversationId,
          )!,
          messages: [],
          capabilities: {
            canCompose: false,
            canReply: false,
            canRetrieveThreads: false,
            canReact: false,
            canMarkRead: false,
            unavailableReason: null,
          },
        };
      },
    };
  }

  test("acknowledges room notifications locally without a provider read mutation", async () => {
    const service = new CommunicationsService();
    const conversations = [
      {
        providerId: "zoom",
        conversationId: "older",
        kind: "direct" as const,
        title: "Ada",
        preview: "Earlier message",
        updatedAt: "2026-08-13T12:00:00.000Z",
        unreadCount: 1,
      },
      {
        providerId: "zoom",
        conversationId: "newer",
        kind: "channel" as const,
        title: "Otto",
        preview: null,
        updatedAt: "2026-08-13T12:01:00.000Z",
        unreadCount: 2,
      },
    ];
    service.registerProvider(createNotifiableProvider(conversations));

    await expect(service.getHome("zoom")).resolves.toMatchObject({
      notifications: [
        { notificationId: "zoom:older:1:2026-08-13T12:00:00.000Z" },
        { notificationId: "zoom:newer:2:2026-08-13T12:01:00.000Z" },
      ],
    });
    await service.getRoom({ providerId: "zoom", conversationId: "older" });
    await expect(service.getHome("zoom")).resolves.toMatchObject({
      notifications: [{ notificationId: "zoom:newer:2:2026-08-13T12:01:00.000Z" }],
    });
  });

  test("a new unread arriving on a previously dismissed conversation reappears", async () => {
    const service = new CommunicationsService();
    const conversations = [
      {
        providerId: "zoom",
        conversationId: "older",
        kind: "direct" as const,
        title: "Ada",
        preview: "Earlier message",
        updatedAt: "2026-08-13T12:00:00.000Z",
        unreadCount: 1,
      },
    ];
    service.registerProvider(createNotifiableProvider(conversations));

    await service.getRoom({ providerId: "zoom", conversationId: "older" });
    await expect(service.getHome("zoom")).resolves.toMatchObject({ notifications: [] });

    // A new message arrives after the room was opened and dismissed.
    conversations[0] = {
      ...conversations[0],
      unreadCount: 1,
      updatedAt: "2026-08-13T13:00:00.000Z",
    };

    await expect(service.getHome("zoom")).resolves.toMatchObject({
      notifications: [{ notificationId: "zoom:older:1:2026-08-13T13:00:00.000Z" }],
    });
  });

  test("getRoom succeeds even when the provider's getHome throws", async () => {
    const service = new CommunicationsService();
    service.registerProvider({
      ...createProvider(),
      async getHome() {
        throw new Error("Home scope was granted after the original token was issued.");
      },
      async getRoom(conversationId) {
        return {
          conversation: (await this.getConversationSummaries()).find(
            (conversation) => conversation.conversationId === conversationId,
          )!,
          messages: [],
          capabilities: {
            canCompose: false,
            canReply: false,
            canRetrieveThreads: false,
            canReact: false,
            canMarkRead: false,
            unavailableReason: null,
          },
        };
      },
    });

    await expect(
      service.getRoom({ providerId: "zoom", conversationId: "older" }),
    ).resolves.toMatchObject({ conversation: { conversationId: "older" } });
  });
});
