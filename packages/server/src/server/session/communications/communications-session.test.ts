import { describe, expect, it, vi } from "vitest";
import type { CommunicationsService } from "../../communications/communications-service.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { CommunicationsSession } from "./communications-session.js";

// Every communications RPC the session dispatches, paired with the response type it
// must answer with. The domain module owns the dispatch, so this is the contract the
// single registration line in session.ts relies on.
const cases: Array<[SessionInboundMessage, string, keyof CommunicationsService]> = [
  [
    { type: "communications.get_overview.request", requestId: "r" },
    "communications.get_overview.response",
    "getOverview",
  ],
  [
    { type: "communications.inbox.get_home.request", requestId: "r", providerId: "zoom" },
    "communications.inbox.get_home.response",
    "getHome",
  ],
  [
    { type: "communications.inbox.search.request", requestId: "r", providerId: "zoom", query: "q" },
    "communications.inbox.search.response",
    "searchDestinations",
  ],
  [
    {
      type: "communications.inbox.set_favorite.request",
      requestId: "r",
      providerId: "zoom",
      conversationId: "c",
      favorite: true,
    },
    "communications.inbox.set_favorite.response",
    "setFavorite",
  ],
  [
    {
      type: "communications.inbox.notifications.acknowledge.request",
      requestId: "r",
      providerId: "zoom",
      notificationIds: ["n"],
    },
    "communications.inbox.notifications.acknowledge.response",
    "acknowledgeNotifications",
  ],
  [
    { type: "communications.inbox.get_presence.request", requestId: "r", providerId: "zoom" },
    "communications.inbox.get_presence.response",
    "getPresence",
  ],
  [
    {
      type: "communications.inbox.set_presence.request",
      requestId: "r",
      providerId: "zoom",
      status: "available",
    },
    "communications.inbox.set_presence.response",
    "setPresence",
  ],
  [
    {
      type: "communications.inbox.set_enabled.request",
      requestId: "r",
      providerId: "zoom",
      enabled: true,
    },
    "communications.inbox.set_enabled.response",
    "setEnabled",
  ],
  [
    {
      type: "communications.inbox.get_messages.request",
      requestId: "r",
      providerId: "zoom",
      conversationId: "c",
    },
    "communications.inbox.get_messages.response",
    "getMessages",
  ],
  [
    {
      type: "communications.inbox.send_message.request",
      requestId: "r",
      providerId: "zoom",
      conversationId: "c",
      text: "hi",
    },
    "communications.inbox.send_message.response",
    "sendMessage",
  ],
  [
    {
      type: "communications.room.get.request",
      requestId: "r",
      providerId: "zoom",
      conversationId: "c",
    },
    "communications.room.get.response",
    "getRoom",
  ],
  [
    {
      type: "communications.room.thread.get.request",
      requestId: "r",
      providerId: "zoom",
      conversationId: "c",
      parentMessageId: "m",
    },
    "communications.room.thread.get.response",
    "getThread",
  ],
  [
    {
      type: "communications.room.message.send.request",
      requestId: "r",
      providerId: "zoom",
      conversationId: "c",
      text: "hi",
    },
    "communications.room.message.send.response",
    "sendRoomMessage",
  ],
  [
    {
      type: "communications.room.reaction.set.request",
      requestId: "r",
      providerId: "zoom",
      conversationId: "c",
      messageId: "m",
      emoji: "👍",
      active: true,
    },
    "communications.room.reaction.set.response",
    "setReaction",
  ],
];

function buildSession() {
  const emitted: SessionOutboundMessage[] = [];
  const service = {
    getOverview: vi.fn(async () => ({ providers: [] })),
    getHome: vi.fn(async () => ({ sections: [], notifications: [] })),
    searchDestinations: vi.fn(async () => []),
    setFavorite: vi.fn(async () => ({ sections: [], notifications: [] })),
    acknowledgeNotifications: vi.fn(async () => ({ sections: [], notifications: [] })),
    getPresence: vi.fn(async () => ({ status: "available" })),
    setPresence: vi.fn(async () => ({ status: "available" })),
    setEnabled: vi.fn(async () => ({ status: "available" })),
    getMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => ({ id: "m" })),
    sendRoomMessage: vi.fn(async () => ({ id: "m" })),
    getRoom: vi.fn(async () => ({ id: "c" })),
    getThread: vi.fn(async () => []),
    setReaction: vi.fn(async () => ({ id: "m" })),
  };
  const session = new CommunicationsSession({
    host: { emit: (msg) => emitted.push(msg) },
    communicationsService: service as unknown as CommunicationsService,
  });
  return { session, service, emitted };
}

describe("CommunicationsSession", () => {
  it.each(cases)("answers %j with the matching response", async (msg, responseType, method) => {
    const { session, service, emitted } = buildSession();
    const handled = session.dispatch(msg);
    expect(handled).toBeInstanceOf(Promise);
    await handled;
    expect(service[method]).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe(responseType);
    expect((emitted[0] as { payload: { requestId: string } }).payload.requestId).toBe("r");
  });

  it("returns undefined for messages outside the domain so the dispatch chain continues", () => {
    const { session, emitted } = buildSession();
    expect(session.dispatch({ type: "ping" } as unknown as SessionInboundMessage)).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });
});
