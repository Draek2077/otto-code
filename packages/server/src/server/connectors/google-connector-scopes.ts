/** Publisher-configured Google Auth Platform Data Access inventory, verified
 * 2026-09-12 in project otto-code. This is not Google verification approval.
 * Change alongside the publisher portal and consent contract.
 */
export const GOOGLE_CONNECTOR_PORTAL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

export const GOOGLE_CONNECTOR_IDENTITY_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

/** Includes supporting profile/raw-email reads for compose/reply/forward.
 * Sources: developers.google.com/workspace/{gmail,drive}/api/reference/rest and
 * developers.google.com/workspace/calendar/api/v3/reference.
 */
export const GOOGLE_CONNECTOR_OPERATION_SCOPES: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  gmail: {
    list_emails: ["gmail.readonly"],
    read_email: ["gmail.readonly"],
    create_draft: ["gmail.readonly", "gmail.compose"],
    send_email: ["gmail.readonly", "gmail.compose"],
    reply_email: ["gmail.readonly", "gmail.compose"],
    forward_email: ["gmail.readonly", "gmail.compose"],
  },
  "google-drive": {
    list_files: ["drive"],
    read_file: ["drive"],
    create_file: ["drive"],
    update_file: ["drive"],
  },
  "google-calendar": {
    list_calendars: ["calendar.calendarlist.readonly"],
    list_events: ["calendar.events"],
    read_event: ["calendar.events"],
    create_event: ["calendar.events"],
  },
};
