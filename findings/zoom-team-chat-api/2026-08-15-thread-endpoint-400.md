# Reply threads 400 against Zoom's `GET .../messages/{messageId}/thread`

**Date:** 2026-08-15
**Question:** Clicking Reply on a Communications Room message (personal chat or channel) always
failed with `Request failed: Zoom Team Chat request failed with status 400.
requestType=communications.room.thread.get.request code=handler_error`. What is Zoom actually
rejecting, and what does the endpoint require?

This report is the audit trail. The fix itself lives in
[`zoom-team-chat-client.ts`](../../packages/server/src/server/communications/zoom-team-chat-client.ts)
and
[`zoom-team-chat-provider.ts`](../../packages/server/src/server/communications/zoom-team-chat-provider.ts).
Whatever follow-up work this implies is a row in [`projects/README.md`](../../projects/README.md),
not here.

---

## Short answer

**Confirmed root cause.** `getMessageThread` (`GET /chat/users/me/messages/{messageId}/thread`) never
sent Zoom's required `from` query parameter at all, and once it did, sent it in the wrong format.
Zoom's real OpenAPI spec for this operation (`operationId: retrieveThread`) requires `from` as
`yyyy-MM-dd'T'HH:mm:ss'Z'` — **no milliseconds**. `Date#toISOString()` always appends `.SSS`
milliseconds, so every timestamp this code ever sent was syntactically well-formed JSON but
semantically invalid to Zoom's validator, regardless of the span or value chosen. `to` is optional
and defaults to the current time server-side; it does not need to be sent.

The fix strips milliseconds with a small `toZoomTimestamp` helper and only sends `from` (6 months
back), leaning on Zoom's documented default for `to`. This was rebuilt against the dev daemon and is
**awaiting one more live reproduction** to confirm — see "Current status" below.

---

## Why this took six rounds to find

Zoom's public docs site (`https://developers.zoom.us/docs/api/chat/`) is a Next.js SPA. Every normal
lookup path failed to surface the actual parameter contract:

- `WebFetch` against the docs URL only ever returned whatever fragment of rendered text happened to
  be in the page shell for that route (channel/mention-group content, never the messages/thread
  operation) — the SPA renders content client-side after the initial HTML.
- The official `zoom/api` GitHub mirror (`openapi.v2.json`, downloaded via `curl`) turned out to be a
  **different, legacy IM Chat API** (`/im/chat/sessions`) with no `messages` paths at all — a dead
  end that looked authoritative but wasn't.
- Zoom's own error responses (`ZoomTeamChatApiError`) are deliberately body-less by design
  (`zoom-team-chat-client.ts:97`, `/** Never includes a provider error response body, which can
contain user content. */`), so the daemon log only ever showed `status 400` with no code or
  message — a correct privacy choice, but it meant the real failure reason was invisible until we
  added temporary diagnostic logging.
- The devforum and community search results never turned up the exact endpoint's parameter list.

The parameter list was only found by extracting the page's embedded `__NEXT_DATA__` JSON blob
directly from the raw HTML (`curl` the docs page, regex out
`<script id="__NEXT_DATA__">...</script>`, parse as JSON) — that payload contains Zoom's full
OpenAPI operation definitions, including ones no rendered page section ever showed through
`WebFetch`.

---

## Method: temporary diagnostic logging

Added a temporary, gated `console.error` in `ZoomTeamChatClient.request()` (removed once the fix
landed) that logged `{ method, path, query, status, body }` on any non-OK response — never touching
the "no response body in logs" policy for the real, permanent build. Each round: edit → `npm run
build:server` → user restarts the dev Electron app (server code runs from `dist/`, so nothing takes
effect without a rebuild + restart) → user clicks Reply → read
`packages/desktop/.dev/otto-home/daemon.log` for the `[zoom-debug] request failed` entry.

## Evidence, in order

| #   | Query sent                                                                         | Zoom response                                                  |
| --- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | `to_contact` only, no `from`/`to` at all                                           | `400 { code: 4233, message: "The \`from\` cannot be blank." }` |
| 2   | `from`/`to` as ISO w/ ms, 6-month span (`toLocalDateString` → then `toISOString`)  | `400 { code: 300, message: "Invalid parameter: to." }`         |
| 3   | `from` only (ISO w/ ms), `to` dropped entirely                                     | `400 { code: 300, message: "Invalid parameter: from." }`       |
| 4   | `from`/`to` as ISO w/ ms, narrowed to 30-day span (mirroring `listRecentSessions`) | `400 { code: 300, message: "Invalid parameter: to." }`         |
| 5   | Same 30-day span, `to` pulled 5 minutes into the past (testing clock-skew theory)  | `400 { code: 300, message: "Invalid parameter: to." }`         |
| 6   | `from` formatted as `yyyy-MM-ddTHH:mm:ssZ` (no ms), `to` omitted                   | _(fix landed; awaiting reproduction)_                          |

Retired hypotheses, in case anyone re-runs this:

- **"`from`/`to` needs the same convention as `listUserChatSessions`."** That call site
  (`zoom-team-chat-provider.ts:735-747`, `listRecentSessions`) does use `from`/`to` as full ISO
  8601 `toISOString()` timestamps successfully against the real `/chat/users/me/sessions` endpoint —
  but that endpoint's validator is evidently more permissive about milliseconds than the thread
  endpoint's. Do not assume every Zoom Team Chat `from`/`to` pair shares one format; check the
  specific operation's spec.
- **Range-size cap.** Tested at 6 months and 30 days with an otherwise-identical shape; both failed
  identically on `to`. Span was never the problem.
- **Clock skew / "`to` reads as future".** Pulling `to` 5 minutes into the past changed nothing.
  Ruled out.
- **`to` being genuinely required.** The spec says `to` is optional, defaulting server-side to the
  current time. The earlier "Invalid parameter: from." result when `to` was omitted (round 3) is now
  understood as the same millisecond-format defect on `from` alone, not evidence that `to` is
  mandatory.

## The confirmed spec

Extracted from Zoom's docs-page `__NEXT_DATA__` payload for `/chat/users/{userId}/messages/{messageId}/thread`:

- **Operation:** `GET /chat/users/{userId}/messages/{messageId}/thread` (`operationId: retrieveThread`)
- **Scopes:** `chat_message:read`, `chat_message:read:admin` (macro) /
  `team_chat:read:thread_message`, `team_chat:read:thread_message:admin` (granular) — matches what
  this codebase already requests (`ZOOM_TEAM_CHAT_ACTIVE_OPERATION_SCOPES.getMessageThread` =
  `"team_chat:read:thread_message"`).
- **Path params:** `userId` (use `me`), `messageId` (the thread's root message).
- **Query params:**
  - `to_channel` **or** `to_contact` — exactly one required (existing code already handles this).
  - `from` — **required.** Format `yyyy-MM-dd'T'HH:mm:ss'Z'`, example `2020-05-01T19:13:02Z`. No
    milliseconds.
  - `to` — optional, same format, defaults to current time if omitted.
  - `limit` — optional, 1-100, default 10.
  - `sort` — optional, `asc`/`desc`, default `desc`.
  - `need_main_message`, `need_emoji`, `need_attachment`, `need_rich_text`, `need_at_items` — optional
    booleans controlling response shape. **None of these are sent today**; the current fix only
    addresses `from`. If replies are missing emoji/attachments/rich text later, this is the first
    place to look.

## The fix as landed

- `toZoomTimestamp(date)` added next to the existing `toLocalDateString` helper in
  `zoom-team-chat-provider.ts` (`return \`${date.toISOString().slice(0, 19)}Z\`;`).
- `ZoomTeamChatProvider.getThread` (`zoom-team-chat-provider.ts:461-489`) now sends only `from`,
  computed as six months before the current time and formatted with `toZoomTimestamp`. `to` is
  omitted, relying on Zoom's documented default.
- `ZoomTeamChatClient.getMessageThread` (`zoom-team-chat-client.ts:336-350`) and the
  `ZoomTeamChatChannelReader#getMessageThread` interface it implements
  (`zoom-team-chat-provider.ts:100-105`) both dropped `to` from their parameter type entirely, since
  it is never sent.
- Focused tests updated: `zoom-team-chat-client.test.ts` ("uses Zoom's documented parent, thread, and
  reaction routes") now asserts a `from`-only query string in `yyyy-MM-ddTHH:mm:ssZ` form.
- All temporary `[zoom-debug]` diagnostic logging in `ZoomTeamChatClient.request()` was reverted once
  the spec was confirmed; the client's "never log the provider error body" policy
  (`zoom-team-chat-client.ts:97`) is back to unmodified.

## Current status

- `npx vitest run` on both `zoom-team-chat-client.test.ts` and `zoom-team-chat-provider.test.ts`:
  passing (42 tests).
- `npx tsc -p tsconfig.server.json --noEmit`: clean.
- `npm run build:server`: rebuilt with the fix.
- **Not yet confirmed live.** The dev daemon needs one more restart + Reply click to verify the
  corrected request actually returns `200` against the real Zoom account, and that reply threads
  render. If it still fails, the next things to check, in order:
  1. Whether `messageId` in the URL path needs to be the literal clicked message (it does today —
     confirm it is always the thread **root**, not a child reply, since nested replies currently
     have no Reply action at all — see
     [`.otto/knowledge/findings/communications-nested-reply-action-gap.md`](../../.otto/knowledge/findings/communications-nested-reply-action-gap.md)).
  2. Whether the granted OAuth scope set actually includes `team_chat:read:thread_message` for this
     account (`requireGrantedScope` would throw a distinct, catchable error before ever calling
     Zoom if not — so a fresh `400` past that point still means the request shape, not the scope).
  3. Whether `limit`/`sort` defaults are adequate, since they are currently unsent and rely on Zoom's
     `10`/`desc` defaults.

## Separate, already-known gaps this does not fix

- The Communications Room only ever fetches **today's** top-level messages
  (`ZoomTeamChatProvider.getMessages` passes `date: toLocalDateString(new Date(this.now()))` to
  `listUserMessages`, `zoom-team-chat-provider.ts:412-418`). Older top-level messages, and by
  extension any thread rooted in them, never appear regardless of this fix.
- There is no reply-count or thread-existence affordance on a top-level message before you click
  Reply — replies are invisible until you explicitly open the thread, by design
  (`layoutCommunicationsTimeline`, `communications-message-layout.ts`, has no `hasReplies`/
  `replyCount` concept).
- Nested replies (children inside an expanded thread) have no Reply action of their own — recorded
  separately in
  [`.otto/knowledge/findings/communications-nested-reply-action-gap.md`](../../.otto/knowledge/findings/communications-nested-reply-action-gap.md).
