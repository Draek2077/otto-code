import type { OAuthPkceClientDefinition } from "../integration-authorization/oauth-pkce.js";

/** This identifies Otto's registered public OAuth integration. It is not a secret. */
export const ZOOM_TEAM_CHAT_PUBLIC_CLIENT_ID = "KOYUZEyvQFMLXmYlZ2r6A";

/**
 * The Zoom Marketplace configuration last verified by the product owner on
 * 2026-08-14. This is intentionally separate from the smaller scope set
 * requested by Otto today: Marketplace approval authorizes a scope to be
 * requested, but it does not grant it to an existing token.
 *
 * When a capability needs another entry, add it here, map the operation below,
 * update the Marketplace configuration, then require a new authorization.
 */
export const ZOOM_TEAM_CHAT_PORTAL_APPROVED_SCOPES = [
  "contact:read:list_contacts",
  "conversation:read:metadata",
  "message:write:content",
  "message:read:content",
  "workspace:read:workspace",
  "workspace:read:list_workspaces",
  "search:read:keywords",
  "team_chat:write:user_message",
  "team_chat:read:list_shared_spaces",
  "team_chat:read:list_shared_space_channels",
  "team_chat:update:chat_control",
  "team_chat:read:list_user_channels",
  "team_chat:read:list_user_messages",
  "team_chat:read:thread_message",
  "team_chat:update:message_emoji",
  "team_chat:update:message_status",
  "team_chat:read:list_user_sessions",
  "team_chat:read:list_contacts",
  "user:update:presence_status",
  "user:read:user",
  "user:read:presence_status",
] as const;

/**
 * Exact REST operations currently called by the Zoom Team Chat adapter and
 * the scopes their official Zoom documentation assigns to them. Keeping this
 * next to the requested scope set makes a missing permission a reviewable
 * code change rather than a production-only OAuth failure.
 */
export const ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES = {
  currentUser: "user:read:user",
  getPresence: "user:read:presence_status",
  setPresence: "user:update:presence_status",
  searchCompanyContacts: "contact:read:list_contacts",
  listUserContacts: "team_chat:read:list_contacts",
  listUserChannels: "team_chat:read:list_user_channels",
  listUserMessages: "team_chat:read:list_user_messages",
  getMessageThread: "team_chat:read:thread_message",
  sendUserMessage: "team_chat:write:user_message",
  setMessageReaction: "team_chat:update:message_emoji",
  listUserSessions: "team_chat:read:list_user_sessions",
  setFavorite: "team_chat:update:chat_control",
  listSharedSpaces: "team_chat:read:list_shared_spaces",
} as const;

/**
 * The OAuth grant Otto asks for today. Do not add a Marketplace-approved
 * scope here until code actually uses the matching capability. This preserves
 * least privilege while the portal inventory records what has already been
 * approved for planned work.
 */
export const ZOOM_TEAM_CHAT_OAUTH_SCOPES = [
  "user:read:user",
  "user:read:presence_status",
  "user:update:presence_status",
  "contact:read:list_contacts",
  "team_chat:read:list_contacts",
  "team_chat:read:list_user_channels",
  "team_chat:read:list_user_messages",
  "team_chat:read:thread_message",
  "team_chat:write:user_message",
  "team_chat:update:message_emoji",
  "team_chat:read:list_user_sessions",
  "team_chat:update:chat_control",
  "team_chat:read:list_shared_spaces",
] as const;

export function createZoomTeamChatOAuthClient(): OAuthPkceClientDefinition {
  return {
    authorizationEndpoint: "https://zoom.us/oauth/authorize",
    tokenEndpoint: "https://zoom.us/oauth/token",
    publicClientId: ZOOM_TEAM_CHAT_PUBLIC_CLIENT_ID,
    scopes: ZOOM_TEAM_CHAT_OAUTH_SCOPES,
  };
}
