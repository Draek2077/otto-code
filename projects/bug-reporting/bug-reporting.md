# Charter: In-app bug reporting

**Status:** Not started — charter drafted 2026-07-15.
**Lineage:** Builds on the provider-neutral git-hosting layer
([docs/git-providers.md](../../docs/git-providers.md),
`packages/server/src/services/git-hosting/`) shipped in 0.5.0. Sibling in spirit to Activity
Stats — a small daemon-owned quality-of-life surface, not a new agent capability.

## Why

The host owner wants coworkers and other users of their Otto host to report bugs **without a
side-channel** ("so my coworkers can report issues without me having to track it all by
communication") and without the reporter needing any account: the reports should land somewhere
trackable — a GitHub issue list — automatically.

The blocker with the naive approach ("open a GitHub issue form") is that reporters would each need
a GitHub account and repo access. The unlock is that **the daemon files the issue, not the
reporter**:

- The host owner configures a target repo once (e.g. `Draek2077/otto-code`) in host settings.
- Anyone connected to that daemon hits **Report a bug**, fills a short form, previews exactly
  what will be sent, and submits.
- The daemon creates the issue using **its own stored credentials** (for GitHub, the host's
  `gh` CLI login — no new secret to manage, per the existing forge-layer contract that "GitHub
  needs no stored credential").

Reporters are effectively **anonymous to GitHub** — every issue is authored by the owner's
account/token. An optional free-text "Reported by" field (a name, a nickname, or blank) is the
only identity, and it's just text in the issue body. This directly satisfies the follow-up
decision: no logged-in reporters, no OAuth complexity.

Trust model: anyone who can reach the daemon's WebSocket can already run agents and execute code
on the host — the WS channel **is** the trust boundary ([SECURITY.md](../../SECURITY.md)). Filing
an issue is a strictly weaker power than what every connected client already holds, so "anyone
connected can report" is acceptable by construction. Light throttles below are about accidents
(loops, double-taps), not adversaries.

## Reporter flow (client)

- **Entry point.** A **Report a bug** item in the settings/help area of the app (all platforms),
  plus the host/workspace overflow menu so it's reachable without digging. It must be visible in
  **User interface mode** — non-developer coworkers are exactly the audience. No shake gesture in
  v1 (cute, but discoverability via menu is enough; revisit later).
- **Form.** Three fields: **title** (required), **description** (required, multiline), **reported
  by** (optional free text — name/handle, never an account). Plus a read-only "what will be
  attached" context block.
- **Auto-attached context** (gathered client- and daemon-side, zero effort for the reporter):
  app version + upstream base version, client platform/OS (iOS / Android / web / desktop),
  daemon version, connected host name, active provider (and model if one is selected). No
  workspace paths or repo names by default — those can leak private project names into the
  target repo (see Open questions).
- **Privacy: preview before send.** Submitting first shows the **exact rendered issue body**
  (title, description, reporter line, context table) with Send / Edit / Cancel. Nothing leaves
  the device that the reporter hasn't seen verbatim. Opt-in attachments (later phases) each get
  their own checkbox in this preview, default off.
- **Result.** On success, show the issue URL (tappable for those who can view the repo; harmless
  text for those who can't). On sink failure, the report is not lost — see fallback below — and
  the reporter is told it was saved for the host owner.

## Daemon side

- **RPC.** One new dotted-namespace pair per
  [docs/rpc-namespacing.md](../../docs/rpc-namespacing.md):
  `support.bug_report.submit.request` / `support.bug_report.submit.response`. Request carries
  title, description, reporterName?, and the client-side context leaves; the daemon appends its
  own (daemon version, host name) so clients can't misreport them. Response carries
  `{ sink: "github-issue" | "local-file", url?, path?, error? }`.
- **Settings (host-scoped, owner-configured).** A `bugReporting` block on
  `MutableDaemonConfigSchema` (same channel as `gitHosting`, written via the daemon-config patch
  RPC): `{ enabled: boolean, targetRepo?: "owner/name", labels?: string[] }`. The repo slug is
  not a secret, so it rides the mutable config, not the private `config.json`. Disabled by
  default; the settings card lives next to the Git providers cards on the Workspaces settings
  page. When disabled or unconfigured, the client hides the entry point (capability + config
  both gate it).
- **Forge layer: add `createIssue`.** `GitHostingService`
  (`packages/server/src/services/git-hosting/types.ts`) has `listIssues` and an `issues`
  capability bit but **no issue-write verb** today. Add
  `createIssue({ repo, title, body, labels }) → { url, number }`:
  - **Repo-targeted, not cwd-resolved.** Every existing method resolves the provider from a
    workspace cwd; bug reports target one fixed repo that may not be any workspace's checkout.
    GitHub implementation: `gh issue create --repo <owner/name> --title … --body-file … --label …`
    (`--repo` overrides remote detection; run from `$OTTO_HOME`). The submit path resolves the
    GitHub service directly (`resolveForProvider("github")`-style), not through the cwd router.
  - **Bitbucket Cloud: don't build it.** Its native tracker is deprecated and off by default
    (`capabilities.issues: false` — "teams use Jira"); the adapter keeps throwing
    `GitHostingUnsupportedCapabilityError`, and non-GitHub hosts use the fallback sink. Add a
    distinct `createIssue` capability bit rather than overloading read-side `issues`.
- **Labels.** Always apply `in-app-report` (plus any owner-configured labels) so the owner can
  filter/triage. `gh issue create` fails if a label doesn't exist in the repo — on that failure,
  retry once without labels rather than losing the report; note the missing label in the
  response so the owner can create it.
- **Throttle & bounds.** Per-connection: max ~5 reports/hour, body capped (~10 KB v1). Not a
  security control (see trust model above) — it prevents a stuck client or double-tap from
  spamming the issue tracker and burning `gh` rate budget. 429-style typed error back to the
  client.

## Fallback sink: daemon-local drop (the one fallback)

For hosts with no GitHub configured — and as the **automatic dead-letter when the GitHub sink
fails** — the daemon writes the report to `$OTTO_HOME/bug-reports/`, one file per report:
`2026-07-15T10-32-05Z-<slug>.md` with a small JSON front-matter header (context fields) and the
markdown body. Reports are never lost; the owner reviews the directory (a count on the settings
card is a cheap later add). **No webhook sink in v1** — a URL sink invites "send user data to a
configured endpoint" questions and a second config surface for marginal gain; the local drop
covers Bitbucket/Jira shops (owner forwards manually) until real demand says otherwise.

## Build sequence

**Phase 1 — GitHub issue via daemon credentials, with auto-context.**

1. `createIssue` on `GitHostingService` + `createIssue` capability bit; GitHub adapter via
   `gh issue create --repo`; Bitbucket throws unsupported.
2. `bugReporting` config block on `MutableDaemonConfigSchema` + settings card (enable toggle,
   target repo, connection-checked like the Git provider cards).
3. `support.bug_report.submit.request/response` + `server_info.features.bugReporting` flag
   (`// COMPAT(bugReporting): added in v0.5.x` at the client gate; older host → entry point
   hidden, standard "update the host" story — no fallback path).
4. Local-drop sink (primary for non-GitHub, dead-letter on GitHub failure) + label-retry +
   throttle.
5. Client: entry point (settings/help + overflow), form, context gathering, **preview-before-send**,
   result states. English strings first, locale parity per the type-enforced i18n contract.
6. Tests: daemon submit path with a fake hosting service (success, label-retry, dead-letter,
   throttle); config gating; schema round-trip.

**Phase 2 — attachments (each opt-in, each shown in the preview).**

7. Recent daemon-log excerpt: last N lines of `$OTTO_HOME/daemon.log`, passed through a redaction
   pass (strip tokens/paths) and shown in full in the preview before send.
8. Screenshot: **constraint** — GitHub has no public API for uploading issue attachments, so a
   client screenshot lands in the local drop next to a stub, with the issue linking to it by
   filename. Don't fake it with base64-in-body.

**Phase 3 — polish.**

9. Dedup hints: before filing, `listIssues` filtered to `in-app-report` and offer "similar
   existing reports" by title match — reporter can +1 (daemon appends a comment) instead of
   filing a duplicate.
10. Settings-card count/list of local-drop reports; webhook sink only if real demand appears.

## Open questions

- **Include workspace/project identity in context?** It helps triage but leaks private repo
  names into the target repo. Lean: off by default, owner-configurable toggle, and always
  visible in the preview when on.
- **`support.*` as the RPC domain?** New top-level namespace vs. reusing `hosting.*`. Lean
  `support.` — the report isn't a hosting operation (the sink might be a local file), and the
  domain will fit future items (feedback, diagnostics bundle).
- **Comment-based +1 vs new issue for duplicates (Phase 3):** appending comments via the owner's
  token multiplies the anonymity question (all voices are one author). Lean: fine — the
  `Reported by` line disambiguates, same as the issues themselves.
- **Should the daemon verify the target repo at config time?** Lean yes: a "check" button on the
  settings card that runs a cheap `gh repo view` so misconfiguration surfaces to the owner, not
  to the first reporter.
- **Offline/queued reports when the daemon is unreachable?** Lean no for v1 — the form requires
  a live host connection like everything else in the app; an offline queue is real complexity
  for a rare case.

## Cross-cutting

- **Protocol contract:** everything additive — new RPC pair, new optional `features.bugReporting`
  flag, new optional config block. No changes to existing schemas.
- **Feature contract:** one capability gate at the entry point; no degraded path on old daemons.
- **Fork mission fit:** provider-neutral by design — the submit path is sink-agnostic
  (`github-issue` today, local-drop everywhere, other forges when their adapters grow
  `createIssue`); GitHub is the proof, not the finish line.
- **Security posture:** no new credentials, no new trust surface (WS connection already implies
  host control); mutation is a single user-initiated RPC, never fired from polling — same
  guardrail as forge-layer merges.
- **Rebuild:** daemon changes → `npm run build:server`; restart to serve.
- **Fold-in on ship:** durable facts (createIssue capability, `support.*` namespace, local-drop
  sink) go into [docs/git-providers.md](../../docs/git-providers.md) plus a short section in
  [docs/architecture.md](../../docs/architecture.md); then delete this folder.
