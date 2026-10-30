/** Otto-owned tools over Google's ordinary account APIs. These URLs identify
 * native integrations; they are not remote MCP endpoints.
 * Scope changes require publisher portal configuration and renewed consent.
 */
export const GOOGLE_CONNECTOR_SERVICES = [
  {
    id: "google-drive",
    label: "Google Drive",
    url: "https://www.googleapis.com/drive/v3",
    description: "Find, read, create and update files in Google Drive.",
    scopes: ["https://www.googleapis.com/auth/drive"],
  },
  {
    id: "gmail",
    label: "Gmail",
    url: "https://gmail.googleapis.com/gmail/v1",
    description: "Find and read emails, create drafts, send, reply and forward.",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
  },
  {
    id: "google-calendar",
    label: "Google Calendar",
    url: "https://www.googleapis.com/calendar/v3",
    description: "List calendars, find and read events, and create events.",
    scopes: [
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
  },
] as const;

export const GOOGLE_CONNECTOR_SOURCE =
  "https://developers.google.com/identity/protocols/oauth2/native-app";
export const CONNECTOR_OAUTH_REDIRECT_URI = "http://127.0.0.1:6871/connectors/oauth/callback";

export function googleConnectorForUrl(url: string) {
  return GOOGLE_CONNECTOR_SERVICES.find((service) => service.url === url);
}

export type GoogleConnectorService = (typeof GOOGLE_CONNECTOR_SERVICES)[number];

export function googleConnectorForConfig(connector: {
  builtin?: string;
  server: { type: string; url?: string };
}) {
  if (!connector.builtin || connector.server.type !== "http") return undefined;
  return GOOGLE_CONNECTOR_SERVICES.find(
    (service) => service.id === connector.builtin && service.url === connector.server.url,
  );
}
