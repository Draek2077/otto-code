const ZOOM_API_BASE_URL = "https://api.zoom.us/v2";
const MAX_PAGE_SIZE = 50;
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 1_100;

export interface ZoomTeamChatChannel {
  id: string;
  name: string | null;
  type: string | null;
}

export interface ZoomTeamChatContact {
  displayName: string | null;
  email: string | null;
  memberId: string | null;
  presenceStatus: string | null;
}

export type ZoomTeamChatUserContactType = "company" | "external";

export interface ZoomTeamChatMessage {
  id: string;
  message: string;
  senderId: string | null;
  senderDisplayName?: string | null;
  timestamp: string | null;
  parentMessageId?: string | null;
  reactions?: ZoomTeamChatReaction[];
}

export interface ZoomTeamChatReaction {
  emoji: string;
  count: number;
  isSender: boolean;
}

export interface ZoomTeamChatSession {
  name: string;
  type: string;
  channelId: string | null;
  peerContactEmail: string | null;
  peerContactMemberId?: string | null;
  lastMessageSentTime: string | null;
}

export interface ZoomTeamChatSharedSpace {
  id: string;
  name: string;
  description: string | null;
}

export interface ZoomTeamChatPresence {
  status: string;
}

export interface ZoomTeamChatCurrentUser {
  id: string | null;
  email: string | null;
  displayName: string | null;
}

export interface ZoomTeamChatPage<T> {
  items: T[];
  nextPageToken: string | null;
}

export interface ZoomTeamChatFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Timestamp captured immediately before the daemon sends the Zoom PUT. */
export interface ZoomTeamChatPresenceUpdateResult {
  sentAt: number;
}

export type ZoomTeamChatFetch = (
  input: string,
  init: {
    method: "GET" | "POST" | "PUT" | "PATCH";
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<ZoomTeamChatFetchResponse>;

export interface ZoomTeamChatClientOptions {
  /**
   * Zoom applies limits at the account level. Keep every Team Chat call from
   * this daemon in one deliberately conservative stream instead of letting a
   * popup refresh fan out into a burst of otherwise-valid API requests.
   */
  minimumRequestIntervalMs?: number;
  now?: () => number;
  sleep?: (durationMs: number) => Promise<void>;
}

/** Never includes a provider error response body, which can contain user content. */
export class ZoomTeamChatApiError extends Error {
  constructor(
    readonly status: number,
    /** Null only when no HTTP request was sent, such as a malformed response. */
    readonly sentAt: number | null = null,
  ) {
    super(`Zoom Team Chat request failed with status ${status}.`);
    this.name = "ZoomTeamChatApiError";
  }
}

/**
 * Zoom-specific REST adapter. It accepts an async token supplier so access and
 * refresh credentials stay in the daemon authorization service rather than in
 * message handlers, renderer state, or this adapter's fields.
 */
export class ZoomTeamChatClient {
  private readonly minimumRequestIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (durationMs: number) => Promise<void>;
  private requestTail: Promise<void> = Promise.resolve();
  private lastRequestCompletedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly getAccessToken: () => Promise<string>,
    private readonly fetch: ZoomTeamChatFetch = globalThis.fetch,
    options: ZoomTeamChatClientOptions = {},
  ) {
    this.minimumRequestIntervalMs =
      options.minimumRequestIntervalMs ?? DEFAULT_MINIMUM_REQUEST_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleep;
  }

  async listUserChannels(
    params: {
      nextPageToken?: string;
      pageSize?: number;
    } = {},
  ): Promise<ZoomTeamChatPage<ZoomTeamChatChannel>> {
    const page = await this.getJson("/chat/users/me/channels", {
      page_size: String(clampPageSize(params.pageSize)),
      ...(params.nextPageToken ? { next_page_token: params.nextPageToken } : {}),
    });
    return {
      items: readArray(page, "channels").flatMap(parseChannel),
      nextPageToken: readOptionalString(page, "next_page_token"),
    };
  }

  async listUserChatSessions(params: {
    from: string;
    to: string;
    nextPageToken?: string;
    pageSize?: number;
  }): Promise<ZoomTeamChatPage<ZoomTeamChatSession>> {
    const page = await this.getJson("/chat/users/me/sessions", {
      from: params.from,
      to: params.to,
      page_size: String(clampPageSize(params.pageSize)),
      ...(params.nextPageToken ? { next_page_token: params.nextPageToken } : {}),
    });
    return {
      items: readArray(page, "sessions").flatMap(parseSession),
      nextPageToken: readOptionalString(page, "next_page_token"),
    };
  }

  /** Zoom returns only native starred sessions when `search_star` is explicit. */
  async listUserStarredChatSessions(
    params: { nextPageToken?: string; pageSize?: number } = {},
  ): Promise<ZoomTeamChatPage<ZoomTeamChatSession>> {
    const page = await this.getJson("/chat/users/me/sessions", {
      search_star: "true",
      page_size: String(clampPageSize(params.pageSize)),
      ...(params.nextPageToken ? { next_page_token: params.nextPageToken } : {}),
    });
    return {
      items: readArray(page, "sessions").flatMap(parseSession),
      nextPageToken: readOptionalString(page, "next_page_token"),
    };
  }

  async setUserChatSessionFavorite(params: {
    targetId: string;
    targetType: "channel" | "contact";
    favorite: boolean;
  }): Promise<void> {
    await this.request("PATCH", "/chat/users/me/events", undefined, {
      method: params.favorite ? "star" : "unstar",
      params: { target_id: params.targetId, target_type: params.targetType },
    });
  }

  async searchCompanyContacts(params: {
    query: string;
    pageSize?: number;
    nextPageToken?: string;
  }): Promise<ZoomTeamChatPage<ZoomTeamChatContact>> {
    const page = await this.getJson("/contacts", {
      search_key: params.query,
      query_presence_status: "true",
      page_size: String(clampPageSize(params.pageSize)),
      ...(params.nextPageToken ? { next_page_token: params.nextPageToken } : {}),
    });
    return {
      items: readArray(page, "contacts").flatMap(parseContact),
      nextPageToken: readOptionalString(page, "next_page_token"),
    };
  }

  /**
   * Lists contacts the signed-in user sees in Zoom Team Chat. This is distinct
   * from the account directory search above: it includes user-added external
   * contacts, which are valid direct-message destinations.
   */
  async listUserContacts(params: {
    type: ZoomTeamChatUserContactType;
    pageSize?: number;
    nextPageToken?: string;
  }): Promise<ZoomTeamChatPage<ZoomTeamChatContact>> {
    const page = await this.getJson("/chat/users/me/contacts", {
      type: params.type,
      page_size: String(clampPageSize(params.pageSize)),
      ...(params.nextPageToken ? { next_page_token: params.nextPageToken } : {}),
    });
    return {
      items: readArray(page, "contacts").flatMap(parseContact),
      nextPageToken: readOptionalString(page, "next_page_token"),
    };
  }

  async listSharedSpaces(
    params: { nextPageToken?: string; pageSize?: number } = {},
  ): Promise<ZoomTeamChatPage<ZoomTeamChatSharedSpace>> {
    const page = await this.getJson("/chat/spaces", {
      page_size: String(clampPageSize(params.pageSize)),
      ...(params.nextPageToken ? { next_page_token: params.nextPageToken } : {}),
    });
    return {
      items: readArray(page, "shared_spaces").flatMap(parseSharedSpace),
      nextPageToken: readOptionalString(page, "next_page_token"),
    };
  }

  async getPresence(): Promise<ZoomTeamChatPresence> {
    const payload = await this.getJson("/users/me/presence_status", {});
    const status = readOptionalString(payload, "status");
    if (!status) throw new ZoomTeamChatApiError(200);
    return { status };
  }

  async getCurrentUser(): Promise<ZoomTeamChatCurrentUser> {
    const payload = await this.getJson("/users/me", {});
    return {
      id: readOptionalString(payload, "id"),
      email: readOptionalString(payload, "email"),
      displayName: readOptionalString(payload, "display_name"),
    };
  }

  async setPresence(params: {
    status: string;
    duration?: number;
  }): Promise<ZoomTeamChatPresenceUpdateResult> {
    const { sentAt } = await this.request("PUT", "/users/me/presence_status", undefined, {
      status: params.status,
      ...(params.duration === undefined ? {} : { duration: params.duration }),
    });
    return { sentAt };
  }

  async listUserMessages(params: {
    channelId?: string;
    contactEmail?: string;
    date: string;
    nextPageToken?: string;
    pageSize?: number;
  }): Promise<ZoomTeamChatPage<ZoomTeamChatMessage>> {
    if ((params.channelId ? 1 : 0) + (params.contactEmail ? 1 : 0) !== 1) {
      throw new Error("Zoom Team Chat messages require exactly one channel or contact target.");
    }
    const page = await this.getJson("/chat/users/me/messages", {
      ...(params.channelId
        ? { to_channel: params.channelId }
        : { to_contact: params.contactEmail! }),
      date: params.date,
      page_size: String(clampPageSize(params.pageSize)),
      ...(params.nextPageToken ? { next_page_token: params.nextPageToken } : {}),
    });
    return {
      items: readArray(page, "messages").flatMap(parseMessage),
      nextPageToken: readOptionalString(page, "next_page_token"),
    };
  }

  async sendUserMessage(params: {
    channelId?: string;
    contactEmail?: string;
    message: string;
    parentMessageId?: string | null;
  }): Promise<{ id: string }> {
    if ((params.channelId ? 1 : 0) + (params.contactEmail ? 1 : 0) !== 1) {
      throw new Error("Zoom Team Chat messages require exactly one channel or contact target.");
    }
    const requestBody: Record<string, unknown> = { message: params.message };
    if (params.channelId) requestBody.to_channel = params.channelId;
    else requestBody.to_contact = params.contactEmail!;
    if (params.parentMessageId) requestBody.reply_main_message_id = params.parentMessageId;
    const { response } = await this.request(
      "POST",
      "/chat/users/me/messages",
      undefined,
      requestBody,
    );
    const payload = await response.json();
    const id = readOptionalString(payload, "id");
    if (!id) throw new ZoomTeamChatApiError(200);
    return { id };
  }

  async getUserMessage(params: {
    channelId?: string;
    contactEmail?: string;
    messageId: string;
  }): Promise<ZoomTeamChatMessage> {
    const query: Record<string, string> = {};
    if (params.channelId) query.to_channel = params.channelId;
    else query.to_contact = params.contactEmail!;
    const message = await this.getJson(
      `/chat/users/me/messages/${encodeURIComponent(params.messageId)}`,
      query,
    );
    const parsed = parseMessage(message)[0];
    if (!parsed) throw new ZoomTeamChatApiError(200);
    return parsed;
  }

  async getMessageThread(params: {
    channelId?: string;
    contactEmail?: string;
    messageId: string;
    from: string;
  }): Promise<ZoomTeamChatPage<ZoomTeamChatMessage>> {
    const page = await this.getJson(
      `/chat/users/me/messages/${encodeURIComponent(params.messageId)}/thread`,
      {
        ...(params.channelId
          ? { to_channel: params.channelId }
          : { to_contact: params.contactEmail! }),
        from: params.from,
      },
    );
    return { items: readArray(page, "messages").flatMap(parseMessage), nextPageToken: null };
  }

  async setUserMessageReaction(params: {
    channelId?: string;
    contactEmail?: string;
    messageId: string;
    emoji: string;
    active: boolean;
  }): Promise<void> {
    await this.request(
      "PATCH",
      `/chat/users/me/messages/${encodeURIComponent(params.messageId)}/emoji_reactions`,
      undefined,
      {
        action: params.active ? "add" : "remove",
        emoji: toZoomEmojiId(params.emoji),
        custom_emoji: false,
        ...(params.channelId
          ? { to_channel: params.channelId }
          : { to_contact: params.contactEmail! }),
      },
    );
  }

  private async getJson(path: string, query: Record<string, string>): Promise<unknown> {
    const { response } = await this.request("GET", path, query);
    return response.json();
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    query?: Record<string, string>,
    body?: Record<string, unknown>,
  ): Promise<{ response: ZoomTeamChatFetchResponse; sentAt: number }> {
    let release: (() => void) | undefined;
    const previousRequest = this.requestTail;
    this.requestTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previousRequest;

    try {
      const elapsedSincePreviousRequest = this.now() - this.lastRequestCompletedAt;
      const remainingDelay = Math.max(
        0,
        this.minimumRequestIntervalMs - elapsedSincePreviousRequest,
      );
      if (remainingDelay > 0) await this.sleep(remainingDelay);

      const token = await this.getAccessToken();
      const url = new URL(`${ZOOM_API_BASE_URL}${path}`);
      if (query) {
        for (const [key, value] of Object.entries(query)) {
          url.searchParams.set(key, value);
        }
      }
      const sentAt = this.now();
      const response = await this.fetch(url.toString(), {
        method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        throw new ZoomTeamChatApiError(response.status, sentAt);
      }
      return { response, sentAt };
    } finally {
      this.lastRequestCompletedAt = this.now();
      release?.();
    }
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize) return MAX_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(pageSize)));
}

function parseChannel(value: unknown): ZoomTeamChatChannel[] {
  if (!isRecord(value) || typeof value.id !== "string") return [];
  return [
    {
      id: value.id,
      name: readOptionalString(value, "name"),
      type: readOptionalString(value, "type"),
    },
  ];
}

function parseContact(value: unknown): ZoomTeamChatContact[] {
  if (!isRecord(value)) return [];
  const displayName =
    readOptionalString(value, "display_name") ??
    ([readOptionalString(value, "first_name"), readOptionalString(value, "last_name")]
      .filter((part): part is string => Boolean(part))
      .join(" ") ||
      null);
  const email = readOptionalString(value, "email");
  const memberId = readOptionalString(value, "member_id");
  if (!displayName && !email && !memberId) return [];
  return [
    {
      displayName,
      email,
      memberId,
      presenceStatus: readOptionalString(value, "presence_status"),
    },
  ];
}

function parseMessage(value: unknown): ZoomTeamChatMessage[] {
  const id = readOptionalString(value, "id") ?? readOptionalString(value, "msg_id");
  if (!isRecord(value) || !id || typeof value.message !== "string") return [];
  return [
    {
      id,
      message: value.message,
      senderId:
        readOptionalString(value, "sender_id") ?? readOptionalString(value, "sender_user_id"),
      senderDisplayName: readOptionalString(value, "sender_display_name"),
      timestamp: readMessageTimestamp(value),
      parentMessageId: readOptionalString(value, "reply_main_message_id"),
      reactions: readArray(value, "reactions").flatMap(parseReaction),
    },
  ];
}

function parseReaction(value: unknown): ZoomTeamChatReaction[] {
  if (!isRecord(value)) return [];
  const emoji = readOptionalString(value, "emoji_id") ?? readOptionalString(value, "emoji");
  const count = value.count ?? value.total_count;
  if (!emoji || typeof count !== "number" || !Number.isInteger(count) || count < 0) return [];
  return [{ emoji, count, isSender: value.is_sender === true }];
}

// Zoom's mutation endpoint takes the API emoji identifier (`U+1F44D`), while
// renderers and the provider-neutral contract use the actual display glyph.
// Keep the conversion at the Zoom boundary so no caller has to know that wire
// detail. Variation selectors are presentation-only and not part of Zoom's id.
function toZoomEmojiId(emoji: string): string {
  if (/^U\+[0-9A-F]{1,6}(?:[_-]U\+[0-9A-F]{1,6})*$/i.test(emoji)) {
    return emoji.toUpperCase();
  }
  return Array.from(emoji)
    .map((character) => character.codePointAt(0))
    .filter((codePoint): codePoint is number => codePoint !== undefined && codePoint !== 0xfe0f)
    .map((codePoint) => `U+${codePoint.toString(16).toUpperCase()}`)
    .join("_");
}

function readMessageTimestamp(value: unknown): string | null {
  const valueString = readOptionalString(value, "date_time");
  if (valueString) return valueString;
  if (
    !isRecord(value) ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp)
  ) {
    return null;
  }
  return new Date(value.timestamp).toISOString();
}

function parseSession(value: unknown): ZoomTeamChatSession[] {
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.type !== "string") {
    return [];
  }
  return [
    {
      name: value.name,
      type: value.type,
      channelId: readOptionalString(value, "channel_id"),
      peerContactEmail: readOptionalString(value, "peer_contact_email"),
      peerContactMemberId: readOptionalString(value, "peer_contact_member_id"),
      lastMessageSentTime: readOptionalString(value, "last_message_sent_time"),
    },
  ];
}

function parseSharedSpace(value: unknown): ZoomTeamChatSharedSpace[] {
  if (
    !isRecord(value) ||
    typeof value.space_id !== "string" ||
    typeof value.space_name !== "string"
  ) {
    return [];
  }
  return [
    {
      id: value.space_id,
      name: value.space_name,
      description: readOptionalString(value, "space_desc"),
    },
  ];
}

function readArray(value: unknown, property: string): unknown[] {
  if (!isRecord(value) || !Array.isArray(value[property])) return [];
  return value[property];
}

function readOptionalString(value: unknown, property: string): string | null {
  if (!isRecord(value) || typeof value[property] !== "string") return null;
  return value[property];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
