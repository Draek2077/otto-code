# Feedback

In-app **Send feedback** — a bug report, an idea, or a note — delivered to Otto's maintainer
without the reporter needing a GitHub account, a login, or any account at all.

## The shape of it

```
App (any platform)  ──HTTPS POST──▶  otto-code.me/api/feedback  ──webhook──▶  Discord channel
```

Three properties drive every decision below:

- **No account for the reporter.** The old Feedback button opened the GitHub issue tracker, which
  is a dead end for anyone without a GitHub account — which is most people who hit a bug.
- **Anonymous by default.** The only identity in a report is an optional free-text contact field.
  Blank means blank; there is nothing else to correlate on.
- **Nothing leaves the device unseen.** The attached context block is rendered verbatim in the
  sheet before sending, and can be switched off entirely.

## Why the client posts directly, not through the daemon

The report goes from the app straight to the intake. It does **not** go through the user's daemon.

That is deliberate: a large share of feedback is _about_ the host connection ("I can't reach my
daemon", "the relay drops"), and a submit path that requires a healthy daemon would be broken
exactly when it is needed. There is also nothing left for the daemon to contribute — no host
credential is involved in delivery — so routing through it would add a protocol RPC, a capability
gate, and a failure mode, and buy nothing.

The consequence to keep in mind: there is **no daemon-side dead-letter**. A failed send is
reported to the reporter in the sheet, and the text stays in the form to retry. Reports are not
queued for later.

## Client

| Piece                              | What it does                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `components/feedback-sheet.tsx`    | The sheet: kind, message, optional contact, context preview, send/sent states |
| `feedback/feedback-payload.ts`     | Pure payload + context-block shaping. All the rules worth testing live here   |
| `feedback/submit-feedback.ts`      | The POST, its 15s timeout, and the reporter-facing wording for each failure   |
| `feedback/use-feedback-context.ts` | Reads the triage facts from the host runtime                                  |

The entry point is the **Feedback** button in `CommunityLinks`, which appears on the open-project
screen and in settings. The sheet keeps a link to the GitHub issue tracker for people who would
rather file there.

**The context block is a closed list**: app version, client platform (and whether it is the
desktop app), and one line per configured host carrying connection status, transport, and daemon
version. No host labels, endpoints, workspace paths, or project names — those leak private
information into a channel the reporter cannot see. `formatFeedbackContext` is the one place that
decides this, and a test pins the exclusion. Widening it is a deliberate change to that contract.

Facts are snapshotted when the sheet opens, not subscribed. A host reconnecting in the background
must not rewrite the block between the moment the reporter reads it and the moment they send it.

## Intake (Cloudflare Worker)

`packages/website/src/feedback-intake.ts`, routed from `server-entry.ts` at `/api/feedback` ahead
of the app router — it is a write-only API, not a page.

- **CORS is open** (`*`). Callers are native, Electron, and web builds on arbitrary origins; the
  endpoint is unauthenticated, write-only, and returns no user data, so there is nothing an origin
  allowlist would protect.
- **Honeypot.** A `honeypot` field the real sheet never sets. Filled means a bot: answer `200 ok`
  and drop it, so there is nothing to tune against.
- **Rate limit.** 5 reports per IP per hour via the `WEBSITE_CACHE` KV binding, `429` past that.
  This is accident control — a stuck client or a double-tap — not a security boundary. KV is
  eventually consistent, so treat it as a soft ceiling.
- **Bounds.** Message 4000 chars, context 1800, contact 200, body 16 KB.
- **Delivery.** A Discord webhook from the `FEEDBACK_WEBHOOK_URL` secret. Message and context each
  get their own embed description: Discord caps a _field_ at 1024 chars but a _description_ at
  4096, and reports routinely exceed 1024.
- The webhook URL is never echoed in a response. A missing secret is reported as a server-side
  misconfiguration (`503`), not as the reporter's fault.

### Configuring the destination

The destination is one Worker secret, so moving it later is a one-command change:

```bash
npx wrangler secret put FEEDBACK_WEBHOOK_URL --cwd packages/website
```

Until that secret exists, the endpoint answers `503` and the sheet tells the reporter that
feedback is not accepting reports right now.

## What this does not do

The [bug-reporting charter](../projects/README.md) also described a **host-owner sink**: a daemon
that files a GitHub issue into an owner-configured repo with its own `gh` credentials, so a team's
coworkers report into that team's tracker. That half is unbuilt, and it is a different feature with
a different audience — it needs `createIssue` on the forge layer
([git-providers.md](git-providers.md)), a `bugReporting` config block, and a daemon RPC. Nothing
here blocks it: the sheet would gain a sink choice, not a rewrite.

Also unbuilt: log excerpts and screenshots as opt-in attachments, and duplicate detection.
