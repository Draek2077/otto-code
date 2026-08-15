import { describe, expect, test } from "vitest";
import { ZoomTeamChatClient } from "./zoom-team-chat-client.js";

describe("ZoomTeamChatClient", () => {
  test("uses a daemon token supplier for a bounded channel read", async () => {
    const calls: Array<{ input: string; init: { headers: Record<string, string> } }> = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input, init) => {
        calls.push({ input, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            channels: [
              { id: "channel-1", name: "Care coordination", type: "group" },
              { id: "channel-2", name: 4 },
            ],
            next_page_token: "next-page",
          }),
        };
      },
      { minimumRequestIntervalMs: 0 },
    );

    await expect(client.listUserChannels({ pageSize: 500 })).resolves.toEqual({
      items: [
        { id: "channel-1", name: "Care coordination", type: "group" },
        { id: "channel-2", name: null, type: null },
      ],
      nextPageToken: "next-page",
    });
    expect(calls).toMatchObject([
      {
        input: "https://api.zoom.us/v2/chat/users/me/channels?page_size=50",
        init: {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: "Bearer daemon-access-token",
          },
        },
      },
    ]);
  });

  test("rejects ambiguous chat targets before making a request", async () => {
    const client = new ZoomTeamChatClient(async () => "unused-token");

    await expect(
      client.listUserMessages({
        channelId: "channel",
        contactEmail: "user@example.test",
        date: "2026-08-13",
      }),
    ).rejects.toThrow(/exactly one channel or contact/i);
  });

  test("searches company contacts with the granted people-search scope", async () => {
    const calls: string[] = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input) => {
        calls.push(input);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contacts: [
              {
                display_name: "Philippe Durand",
                email: "philippe@example.test",
                member_id: "member-1",
                presence_status: "Available",
              },
            ],
          }),
        };
      },
      { minimumRequestIntervalMs: 0 },
    );

    await expect(client.searchCompanyContacts({ query: "phi", pageSize: 8 })).resolves.toEqual({
      items: [
        {
          displayName: "Philippe Durand",
          email: "philippe@example.test",
          memberId: "member-1",
          presenceStatus: "Available",
        },
      ],
      nextPageToken: null,
    });
    expect(calls).toMatchObject([
      "https://api.zoom.us/v2/contacts?search_key=phi&query_presence_status=true&page_size=8",
    ]);
  });

  test("lists the signed-in user's external contacts", async () => {
    const calls: string[] = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input) => {
        calls.push(input);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            contacts: [
              {
                first_name: "Carey",
                last_name: "Miller",
                email: "carey@example.test",
                member_id: "member-2",
              },
            ],
          }),
        };
      },
      { minimumRequestIntervalMs: 0 },
    );

    await expect(client.listUserContacts({ type: "external", pageSize: 8 })).resolves.toEqual({
      items: [
        {
          displayName: "Carey Miller",
          email: "carey@example.test",
          memberId: "member-2",
          presenceStatus: null,
        },
      ],
      nextPageToken: null,
    });
    expect(calls).toEqual([
      "https://api.zoom.us/v2/chat/users/me/contacts?type=external&page_size=8",
    ]);
  });

  test("reads bounded recent sessions and shared spaces without exposing tokens", async () => {
    const calls: string[] = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input) => {
        calls.push(input);
        return {
          ok: true,
          status: 200,
          json: async () =>
            input.includes("/sessions")
              ? {
                  sessions: [
                    {
                      name: "care@example.test",
                      type: "1:1",
                      peer_contact_email: "care@example.test",
                      last_message_sent_time: "2026-08-13T12:00:00.000Z",
                    },
                  ],
                }
              : {
                  shared_spaces: [
                    {
                      space_id: "space-1",
                      space_name: "Care coordination",
                      space_desc: "Private planning",
                    },
                  ],
                },
        };
      },
      { minimumRequestIntervalMs: 0 },
    );

    await expect(
      client.listUserChatSessions({
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-13T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      items: [{ peerContactEmail: "care@example.test" }],
    });
    await expect(client.listSharedSpaces()).resolves.toMatchObject({
      items: [{ id: "space-1", name: "Care coordination" }],
    });
    expect(calls.join(" ")).not.toContain("daemon-access-token");
  });

  test("reads and updates Zoom-native starred chat sessions", async () => {
    const calls: Array<{ input: string; init: { method: string; body?: string } }> = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input, init) => {
        calls.push({ input, init });
        return {
          ok: true,
          status: init.method === "PATCH" ? 204 : 200,
          json: async () => ({
            sessions: [
              {
                name: "care@example.test",
                type: "1:1",
                peer_contact_email: "care@example.test",
              },
            ],
          }),
        };
      },
      { minimumRequestIntervalMs: 0 },
    );

    await expect(client.listUserStarredChatSessions()).resolves.toMatchObject({
      items: [{ peerContactEmail: "care@example.test" }],
    });
    await expect(
      client.setUserChatSessionFavorite({
        targetId: "care@example.test",
        targetType: "contact",
        favorite: false,
      }),
    ).resolves.toBeUndefined();
    expect(calls).toMatchObject([
      {
        input: "https://api.zoom.us/v2/chat/users/me/sessions?search_star=true&page_size=50",
        init: { method: "GET" },
      },
      {
        input: "https://api.zoom.us/v2/chat/users/me/events",
        init: {
          method: "PATCH",
          body: JSON.stringify({
            method: "unstar",
            params: { target_id: "care@example.test", target_type: "contact" },
          }),
        },
      },
    ]);
  });

  test("sends a message only to one selected target", async () => {
    const calls: Array<{ input: string; init: { body?: string } }> = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input, init) => {
        calls.push({ input, init });
        return { ok: true, status: 201, json: async () => ({ id: "message-id" }) };
      },
      { minimumRequestIntervalMs: 0 },
    );

    await expect(
      client.sendUserMessage({ channelId: "channel id", message: "Context from Otto" }),
    ).resolves.toEqual({ id: "message-id" });
    expect(calls[0]).toEqual({
      input: "https://api.zoom.us/v2/chat/users/me/messages",
      init: {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer daemon-access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: "Context from Otto", to_channel: "channel id" }),
      },
    });
  });

  test("reads and updates presence through the daemon token supplier", async () => {
    const calls: Array<{ input: string; init: { method: string; body?: string } }> = [];
    const sentAt = Date.parse("2026-08-14T12:00:00.000Z");
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input, init) => {
        calls.push({ input, init });
        return {
          ok: true,
          status: init.method === "PUT" ? 204 : 200,
          json: async () => ({ status: "Available" }),
        };
      },
      { minimumRequestIntervalMs: 0, now: () => sentAt },
    );

    await expect(client.getPresence()).resolves.toEqual({ status: "Available" });
    await expect(client.setPresence({ status: "Do_Not_Disturb", duration: 20 })).resolves.toEqual({
      sentAt,
    });
    expect(calls).toMatchObject([
      { input: "https://api.zoom.us/v2/users/me/presence_status", init: { method: "GET" } },
      {
        input: "https://api.zoom.us/v2/users/me/presence_status",
        init: { method: "PUT", body: JSON.stringify({ status: "Do_Not_Disturb", duration: 20 }) },
      },
    ]);
  });

  test("uses Zoom's documented parent, thread, and reaction routes", async () => {
    const calls: Array<{ input: string; init: { method: string; body?: string } }> = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async (input, init) => {
        calls.push({ input, init });
        let status = 200;
        if (init.method === "POST") status = 201;
        if (init.method === "PATCH") status = 204;
        return {
          ok: true,
          status,
          json: async () => ({
            id: "reply-1",
            messages: [
              {
                msg_id: "reply-1",
                message: "Child",
                timestamp: Date.parse("2026-08-14T12:00:00.000Z"),
                sender_display_name: "Ada",
                reply_main_message_id: "root-1",
                reactions: [{ emoji_id: "U+1F44D", count: 2, is_sender: true }],
              },
            ],
          }),
        };
      },
      { minimumRequestIntervalMs: 0 },
    );

    await client.sendUserMessage({
      channelId: "channel-1",
      message: "Child",
      parentMessageId: "root-1",
    });
    await expect(
      client.getMessageThread({
        channelId: "channel-1",
        messageId: "root-1",
        from: "2026-07-15T12:00:00Z",
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: "reply-1",
          parentMessageId: "root-1",
          reactions: [{ emoji: "U+1F44D", count: 2 }],
        },
      ],
    });
    await client.setUserMessageReaction({
      channelId: "channel-1",
      messageId: "reply-1",
      emoji: "👍",
      active: true,
    });
    expect(calls).toMatchObject([
      {
        init: {
          method: "POST",
          body: JSON.stringify({
            message: "Child",
            to_channel: "channel-1",
            reply_main_message_id: "root-1",
          }),
        },
      },
      {
        input:
          "https://api.zoom.us/v2/chat/users/me/messages/root-1/thread?to_channel=channel-1&from=2026-07-15T12%3A00%3A00Z",
        init: { method: "GET" },
      },
      {
        input: "https://api.zoom.us/v2/chat/users/me/messages/reply-1/emoji_reactions",
        init: {
          method: "PATCH",
          body: JSON.stringify({
            action: "add",
            emoji: "U+1F44D",
            custom_emoji: false,
            to_channel: "channel-1",
          }),
        },
      },
    ]);
  });

  test("reads the OAuth user's identity without exposing its access token", async () => {
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: "user-1", email: "work@example.test", display_name: "Philippe" }),
      }),
      { minimumRequestIntervalMs: 0 },
    );

    await expect(client.getCurrentUser()).resolves.toEqual({
      id: "user-1",
      email: "work@example.test",
      displayName: "Philippe",
    });
  });

  test("paces consecutive Team Chat requests through one daemon stream", async () => {
    let now = 0;
    const delays: number[] = [];
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async () => ({ ok: true, status: 200, json: async () => ({ channels: [] }) }),
      {
        minimumRequestIntervalMs: 1_100,
        now: () => now,
        sleep: async (durationMs) => {
          delays.push(durationMs);
          now += durationMs;
        },
      },
    );

    await client.listUserChannels();
    await client.listUserChannels();

    expect(delays).toEqual([1_100]);
  });

  test("does not expose provider error content", async () => {
    const client = new ZoomTeamChatClient(
      async () => "daemon-access-token",
      async () => ({
        ok: false,
        status: 403,
        json: async () => ({ message: "PHI must not be surfaced" }),
      }),
      { minimumRequestIntervalMs: 0 },
    );

    await expect(client.listUserChannels()).rejects.toMatchObject({
      name: "ZoomTeamChatApiError",
      status: 403,
      sentAt: expect.any(Number),
      message: "Zoom Team Chat request failed with status 403.",
    });
  });
});
