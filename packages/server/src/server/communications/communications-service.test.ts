import { describe, expect, test } from "vitest";
import type { CommunicationPresence } from "@otto-code/protocol/communications";
import { CommunicationsService, type CommunicationsProvider } from "./communications-service.js";

function createProvider(): CommunicationsProvider {
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
      return [
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
});
