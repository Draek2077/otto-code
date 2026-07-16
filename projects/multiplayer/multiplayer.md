# Charter: Multiplayer Otto ("pair vibe coding")

**Status:** Charter — questions-first, not started. Drafted 2026-07-15.
**Lineage:** Builds directly on the daemon's existing multi-client WebSocket model
([docs/architecture.md](../../docs/architecture.md)), the relay E2E trust model
([SECURITY.md](../../SECURITY.md), `packages/relay`), and — for shared steering — the
[steer-queue charter](../steer-queue/steer-queue.md).

The user's vision, verbatim:

> "gotta figure out how to make Otto multi-player. so we can synchronize some type of way to work
> together. Not by forcing things to be the same everywhere, but instead, allowing users to go in
> and out of each other's workspaces, and be able to see each other's 'presence' where they are
> focused, where they are looking, and allow each other to provide interactions as well (driving
> together)."

Two design commitments fall straight out of that sentence and govern everything below:

1. **No forced mirroring.** Every participant keeps their own layout, tabs, scroll positions, and
   navigation. Multiplayer is _awareness plus optional convergence_ (a "follow" you opt into), never
   a shared screen. This is also the cheap path: Otto's tabs are already per-client layout state
   ([docs/agent-lifecycle.md](../../docs/agent-lifecycle.md#tabs-vs-archive)), so independence is
   the default we get for free — mirroring would be the thing we'd have to build.
2. **Presence is ephemeral.** Where someone is looking is a live signal, not a record. Nothing
   about presence is ever written to `$OTTO_HOME`. When you disconnect, you were never there.

---

## Why this is closer than it looks

Multiplayer sounds like a huge feature. Most of the hard substrate already exists, because Otto was
built client-server from day one:

| Needed for multiplayer                              | Already exists                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Multiple people connected to one dev environment    | The daemon accepts many simultaneous WebSocket clients today — your phone + desktop + CLI already co-exist. A second _person_ is protocol-wise just another client.                                                                 |
| Shared, consistent world state                      | Agent state, timelines, archive, workspace status are all daemon-owned and broadcast to every subscriber (`agent_update`, `agent_stream`, `workspace_update`). Two viewers of the same agent already see the same thing, live.      |
| Both people acting on the same agent                | Permission responses, prompts, stop/archive are all daemon RPCs — any connected client can already do them. Multiplayer doesn't add this ability; it adds _attribution and coordination_ around an ability that silently exists.    |
| Secure remote access for a second person            | The relay: per-connection ephemeral Curve25519 keys, XSalsa20-Poly1305, zero-knowledge relay. Each connection is its own independently encrypted channel — there is no shared "room key" to design.                                 |
| An envelope class for ephemeral non-session signals | The top-level `recording_state` WS envelope — accepted and currently dropped by the server (`websocket-server.ts` ~L1780). Presence is exactly this shape of message: high-frequency, lossy-OK, never persisted, not a session RPC. |

What does **not** exist: any notion of _who_ a client is (the `hello` carries `clientId`,
`clientType`, `appVersion` — no human name), any fan-out of one client's focus to other clients,
any per-participant authorization tier, and any UI for other humans. That's the actual project.

---

## 1. Usefulness — scenarios, ranked honestly

**High value (build for these):**

- **Pair vibe coding — two people steering one agent.** The core ask. One person prompts, the
  other watches the stream on their own device, jumps in with a follow-up or answers a permission
  request while the first is thinking. Because agents are daemon-owned, this _almost works today_ —
  what's missing is knowing your partner is there, seeing what they're looking at, and not
  clobbering each other's prompts (see §5).
- **Review-together.** "Come look at this diff." Host opens the Changes tab; guest follows to the
  same file at the same scroll region, both talk over voice they already have (Discord/call).
  Presence + follow makes "which file? scroll down. no, the other hunk" evaporate.
- **Mentor watches junior.** Asymmetric: the mentor mostly observes (which workspace, which agent,
  what the agent is doing), occasionally drops a steering prompt. This is the strongest argument
  for a **read-only participant tier** eventually — a mentor you'd invite to watch is not always
  someone you'd hand your shell to.
- **Team lead peeking at an agent fleet.** Lead connects to a teammate's daemon, sees the runs
  screen and workspace activity, doesn't touch anything. Really a special case of the above; falls
  out of read-only presence for free.

**Real but secondary:**

- **Handoff with context.** "I'm going to bed, agent's mid-refactor, here's where I was" — presence
  makes the handoff moment legible, but async handoff mostly works today via the shared timeline.

**Gimmick (do not build):**

- **Live shared cursors in the text editor.** Google-Docs-style character cursors imply co-editing
  expectations we explicitly won't meet (§5, Phase 3). A file-level "Sam is viewing
  `agent-manager.ts`" delivers 80% of the awareness at 2% of the cost and creep factor.
- **Persistent presence history / "who looked at what" logs.** Surveillance, not collaboration.
  Violates commitment 2. Never.

The honest framing: multiplayer's unit of collaboration in Otto is **the agent, not the file**.
Two people don't converge on a text buffer (that's VS Code Live Share's problem); they converge on
_an agent's conversation and its output_. That reframing is what makes this project tractable.

## 2. The presence model — what "presence" concretely means

Presence granularity is a dial from useful to creepy. Proposed tiers, coarse→fine:

| Tier | Signal                                                                                                                                                      | Verdict                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0   | **Who's here** — participant list per daemon: name, color, device type, connected/idle                                                                      | Required. The roster is the foundation; everything renders relative to it.                                                                                                         |
| P1   | **Where they are** — active workspace + focused tab (agent X / file Y / terminal Z / diff)                                                                  | Required. This is the "where they are focused" of the vision. One update per focus change — cheap, legible, maps to real UI anchors (avatar dot on the workspace row, on the tab). |
| P2   | **What they're viewing within it** — file path + rough viewport region for file/diff tabs; "scrolled to bottom / reading history at turn N" for agent panes | Include for file/diff tabs (it's what makes review-together work). Coarse: a line-range bucket, throttled (≥500ms), not pixel scroll.                                              |
| P3   | **Composer typing indicator** — "Sam is typing a prompt to agent X"                                                                                         | Include, boolean only (never keystrokes/content). Directly prevents the two-drivers-collide problem in §5 — it's coordination, not surveillance.                                   |
| P4   | **Live editor cursor position** (line/col, character-level)                                                                                                 | Exclude from v1. Only meaningful with co-editing, which is out of scope. File-level presence (P2) covers awareness.                                                                |
| P5   | **Mouse position / eye-tracking-style trails**                                                                                                              | Never. Creepy, noisy, useless without shared pixels — and layouts aren't shared (commitment 1).                                                                                    |

Two cross-cutting rules:

- **Presence is symmetric and visible.** You always see exactly what others see about you (an
  "as others see you" self-chip), and there is no invisible-observer mode. If someone is watching
  your daemon, you know. This is the single most important anti-creep property, worth more than
  any granularity tuning.
- **Presence is lossy and last-write-wins.** No ordering guarantees, no acks, no reconciliation.
  A dropped presence frame costs nothing; the next one corrects it. This keeps it out of the
  timeline/RPC machinery entirely.

**"Follow" mode** is the opt-in convergence primitive: tap a participant's avatar → "Follow Sam" →
your client navigates to whatever P1 focus Sam broadcasts (their workspace/tab; and for file tabs,
their P2 region), until you interact, which breaks the follow (cursor-chase is a well-known
frustration; interacting = you've taken back your own view). Follow is a pure client-side consumer
of presence — the daemon doesn't know or care that you're following.

## 3. Architecture

### The daemon is the broker — presence never touches disk

Presence is **daemon-brokered ephemeral state**: an in-memory map
`participantId → { identity, focus, updatedAt }` owned by a small `PresenceService` sibling to the
session layer. Clients publish their own focus; the daemon fans out a coalesced roster to all
subscribed clients. Nothing writes to `$OTTO_HOME`; a daemon restart wipes presence and clients
simply re-publish on reconnect. This mirrors how `background_shell_tasks_changed` pushes full
current lists — reconciliation by snapshot, not by diffs — which is the right shape for lossy
state.

Rate discipline: client-side throttling (focus changes are naturally rare; P2 scroll buckets at
≥500ms) plus daemon-side coalescing (at most N roster broadcasts/sec). Presence must be invisible
in the daemon's performance profile — the terminal-latency work
([docs/terminal-performance.md](../../docs/terminal-performance.md)) sets the standard for not
letting chatty side-channels degrade the hot path.

### Identity without accounts — name the _person_, not the connection

Otto has no accounts and must not grow them for this (product philosophy: no forced accounts). But
`clientId` is the wrong identity too — one person is often connected from three devices at once,
and should render as **one participant with three device glyphs**, not three strangers.

Proposal: a **device-local profile** — `{ participantId: <stable random UUID>, displayName, color }`
— generated once per Otto installation, editable in Settings (like a device name), sent in the
`hello` (additive optional `participant` field). The daemon groups sessions by `participantId` for
the roster. Multiple devices of one person share nothing today, so cross-device same-person
grouping is best-effort (each install gets its own id; the user can set the same name, and the
roster can merge by identical display name as a cosmetic nicety — but don't build identity
infrastructure to solve a cosmetic problem).

Honest limitation, stated up front: **names are self-asserted and unauthenticated.** Anyone your
daemon admits can call themselves anything. Within this feature's trust model (you invited them —
§4) that's acceptable, exactly as it is in a Zoom room. The moment names gate _authorization_
(read-only tiers), they must be bound to the connection's pairing credential, not to the
self-asserted profile — see §4.

### Protocol surface (all additive, per the protocol contract)

- `participant?: { id, displayName, color }` on `WSHelloMessage` — optional, old daemons ignore it.
- A new lightweight envelope or session message pair:
  `presence.publish` (client→daemon: my current focus, fire-and-forget) and
  `presence_roster` (daemon→clients: full coalesced roster). Follow the `recording_state`
  precedent for "top-level, non-RPC, droppable" — or ride session messages if the envelope union
  proves awkward; either is additive.
- `features.presence` capability flag, COMPAT-tagged. Old client on new daemon: no roster sent
  (client never subscribed). New client on old daemon: no flag → no multiplayer UI. No fallback
  paths, per the feature contract.
- Focus payloads reference **opaque ids only** (workspaceId, agentId, tab kind + file path). No
  new authority is granted by presence — it describes views of things the client could already see.
- Later phases (attribution, §5) add `initiatedBy?: { participantId, displayName }` to prompt
  requests and permission resolutions — additive optional leaves on existing messages.

### What multiplayer explicitly does _not_ restructure

No CRDTs, no OT, no shared-document layer, no daemon-side "room" objects, no client-to-client
channels (everything brokers through the daemon — two relay participants have no shared key and
must not get one). The daemon's existing authority model — daemon owns state, clients render it —
is exactly right for multiplayer and is the reason this project is a set of additive leaves rather
than a rewrite.

## 4. Security and encryption — the honest section

### What the current model already gives us

Each connection is **independently end-to-end encrypted**: the client generates a fresh ephemeral
Curve25519 keypair, ECDHs against the daemon's persistent key, and gets its own
XSalsa20-Poly1305 channel. Two participants over the relay share **no key material** — the daemon
decrypts from A and re-encrypts to B. There is no group-key problem to solve, no key rotation
dance when someone leaves. Multi-party E2E is, cryptographically, **already done**. Presence
frames ride inside these existing channels; zero new crypto is required for any phase of this
charter.

### What it does not give us: distinguishing participants

The trust anchor is the pairing link/QR, which carries the daemon's public key — and **every
participant today would use the same one**. The daemon cannot cryptographically tell "me on my
phone" from "the friend I invited": both present valid handshakes against the same daemon key.
Combined with SECURITY.md's stated boundary — _"Connected clients are trusted operators of the
daemon user"_ — inviting someone currently means handing them your daemon, forever, anonymously.

That's the gap. The fix is **per-participant invites**:

- Inviting someone mints an **invite token**: a distinct credential (bearer token or per-invite
  key) carried in the pairing URL/QR, bound to a participant record the daemon stores
  (`{ inviteId, label ("Sam"), createdAt, expiresAt?, revoked? }`). The connection presents it
  during/immediately after the E2E handshake, before any session messages are processed —
  the same "no application messages until authenticated" gate the e2ee handshake already enforces.
- **Revocation** = flipping `revoked` on the record: the daemon drops that participant's live
  connections and refuses the token thereafter. This is the killer property the shared-QR model
  can never have — today "un-inviting" someone means rotating the daemon keypair and re-pairing
  every one of your own devices.
- The **owner's own devices** keep the current pairing flow (or become the implicit root invite).
  Guests get guest invites. Authorization tier (§below) hangs off the invite record — a
  _cryptographically-bound_ identity, unlike the cosmetic self-asserted display name in §3.
- Invites should default to **expiring** (e.g. 7 days to first use) and the Settings UI lists
  active participants with last-seen and a revoke button. An invite you can't see and can't kill
  is a liability, not a feature.

This is the one genuinely new security mechanism the project needs, and it's useful beyond
multiplayer (it retroactively gives the existing single-user multi-device story named, revocable
devices). It should be designed with care and reviewed against SECURITY.md's threat model —
notably: invite tokens must never transit the relay in plaintext frames (they ride inside the
E2E channel or the URL fragment, which the web server never sees, like the current offer).

### Scoping to specific workspaces: mostly fiction in v1 — say so

Can we invite someone into _one workspace_ only? **Honestly: not without a much bigger project.**
The daemon's surfaces are host-global: file RPCs may read any file the daemon user can read
(explicitly documented as authority, not boundary), terminals are real shells (a shell escapes any
workspace fence in one `cd`), agents can be created in any cwd, and dozens of RPCs
(`directory_suggestions_request`, project registry, checkout ops) assume host-wide reach. A
"workspace-scoped guest" would require auditing and gating every RPC handler — a serious,
security-critical project with a huge bypass surface if done sloppily. **Do not fake it with UI
filtering**: hiding other workspaces client-side while the daemon answers anything is a scope
_illusion_, and shipping an illusion as a security boundary is worse than shipping nothing.

What **is** feasible short of that, in order of increasing cost:

1. **All-or-nothing with informed consent (v1).** The invite flow says plainly: "Sam will be able
   to see and control everything on this daemon — every project, file, terminal, and agent — until
   you revoke access." Ugly, honest, shippable. Practically, the real-world mitigation is
   dedicated daemons: a VM/container/secondary machine daemon for pairing sessions. Docker images
   exist ([docs/docker.md](../../docs/docker.md)); documenting "spin up a pairing daemon" is a
   legitimate v1 answer.
2. **Read-only tier (v1.5, feasible).** Enforce at the two chokepoints all mutations flow through:
   the session RPC dispatch (deny mutating RPCs for read-only invites — deny-by-default against an
   allowlist of read RPCs, in the spirit of [docs/safe-unattended.md](../../docs/safe-unattended.md)'s
   posture) and terminal input frames (drop them). Coarse but enforceable, because it's
   deny-by-default rather than per-resource. This unlocks mentor-watches and lead-peeks safely.
   Caveat to state in the UI: read-only still means _read everything_ — code, env files, agent
   conversations. It's a control boundary, not a confidentiality one.
3. **True workspace scoping (explicitly deferred, maybe forever).** Only worth revisiting if
   multiplayer proves heavily used across trust boundaries; the honest alternative (separate
   daemon per trust domain) may simply be the right architecture, matching Otto's local-first,
   daemon-as-infrastructure bet.

### Threat-model deltas to record when this ships

Presence adds a mild information channel (guests learn your focus patterns while connected —
mitigated by symmetry and the roster being visible); invites add a credential class
(mitigated by expiry + revocation + the participant list); prompt attribution adds spoofing
considerations (attribution must come from the daemon's session→invite binding, never from a
client-supplied name field). Fold these into SECURITY.md on ship.

## 5. "Driving together" — staged interaction

### Phase M1 — read-only presence + follow (the recommended first slice)

Roster (P0), focus (P1), file/diff viewport (P2), typing indicator (P3), follow mode, participant
identity in hello, presence settings row (including "share my presence" master toggle — presence
is mutual: turning it off also hides others' presence from you, no lurker mode). No authorization
changes: v1 assumes symmetric full-trust participants (informed-consent invite copy from §4.1).
Ships value alone: two people with today's abilities plus awareness is already pair-capable, since
prompts and permissions already work from any client.

### Phase M2 — coordinated shared steering

Both participants prompt the same agent. The daemon already serializes this (one foreground turn;
a second prompt interrupts via `replaceAgentRun`) — the problem isn't concurrency, it's _courtesy
and attribution_:

- **Attribution.** Timeline user-turns and permission resolutions carry
  `initiatedBy` (participant id + name at time of action, denormalized so renames don't rewrite
  history). Rendered as a small avatar chip on the turn. This is the difference between "the agent
  got a prompt" and "Sam steered it" — essential the moment two humans share an agent, and
  arguably a nice-to-have for today's multi-device single user too. Note this touches persisted
  timeline rows — the one place multiplayer stores anything, and it's storing _actions_ (which are
  already stored), not presence.
- **Collision handling.** When you prompt an agent that is running because your partner prompted
  it, default to **queue, not interrupt** — this is precisely the steer-queue charter's
  `delivery: "queue"` mode, and multiplayer is its strongest motivating case (clobbering an
  agent's turn is rude; clobbering your _partner's_ turn is a fight). **Sequencing: build
  steer-queue Phase 1 before M2** — M2 then only adds the human-collision default and a
  "Partner's prompt is queued" surface. The P3 typing indicator prevents most collisions before
  they happen.
- **Permission races.** Two people answering the same permission request: first daemon-received
  resolution wins, the loser gets a gentle "already answered by Sam" — likely close to today's behavior
  plus attribution; verify the resolution path is idempotent rather than double-firing.

### Phase M3 — live co-editing: named and declined

Simultaneous character-level editing of one buffer is CRDT/OT territory (Yjs-class conflict
resolution, per-keystroke sync, cursor transforms through concurrent edits, undo semantics). It is
a different product (VS Code Live Share, ~years of engineering) and it is **out of scope,
indefinitely**. Otto's wager is that the agent is the pen: two people co-_steer_ the agent that
edits, rather than co-editing by hand. The daemon's existing save-conflict/watch model
([docs/text-editor.md](../../docs/text-editor.md)) already arbitrates the rare case of two humans
hand-editing the same file — sequential edits with conflict detection, not merged keystrokes. If
real demand for hand co-editing emerges, evaluate embedding an existing CRDT engine then; do not
hand-roll one.

## 6. Explicitly out of scope for v1

- **Live co-editing / editor character cursors** — §5 M3.
- **Workspace-scoped guests** — fiction without a daemon-wide authorization audit; §4.3. V1 is
  all-or-nothing with informed consent.
- **Accounts, cloud identity, or any central user registry** — against product philosophy; identity
  is device-local profile + per-invite credential.
- **Voice/video/text chat between participants** — people already have Discord/Meet/Slack; Otto
  adds the shared _environment_, not the call. (The existing agent-facing chat rooms are not a
  human-to-human channel and shouldn't be bent into one for v1.)
- **Cross-daemon multiplayer** ("both of us in _my_ daemon and _your_ daemon as one session") —
  interesting, enormous, later. V1 multiplayer = guests in one host's daemon.
- **Presence history/analytics of any kind** — commitment 2.
- **Mirrored layouts / forced navigation** — commitment 1. Follow is opt-in and breaks on
  interaction.

## 7. Open questions — decisions for the user, each with a recommendation

1. **Trust posture for v1: symmetric full-trust, or block on read-only invites?**
   Recommend: ship M1 as full-trust with brutally honest invite copy; build the read-only tier as
   M1.5 immediately after (it's the mentor/lead unlock and it's cheap at the RPC-dispatch
   chokepoint). Don't block awareness features on authorization work.
2. **Per-participant invites: prerequisite or follow-up?** Shared-QR means anonymous,
   irrevocable guests. Recommend: **prerequisite for inviting anyone who isn't you** — revocation
   and a visible participant list are the minimum bar for handing out daemon access; M1 without
   invites is only safe as a same-person-multi-device demo.
3. **Where does presence ride — new top-level envelope (like `recording_state`) or session
   messages?** Recommend: session messages behind `features.presence` for tooling/validation
   consistency (zod-aot, session.supports), unless frequency proves problematic; the envelope is
   the escape hatch.
4. **Typing indicator scope:** boolean-per-agent-composer only (recommended), or include draft
   length/preview? Recommend boolean only — content preview is creep with no coordination value.
5. **Should prompt attribution (M2) also cover today's single-user multi-device case** (label
   which _device_ sent a turn)? Recommend yes — same field, immediate value, and it forces the
   attribution plumbing to be honest (daemon-derived, not client-asserted) from day one.
6. **Queue-by-default on partner collision (M2):** always queue when the running turn was
   initiated by a _different_ participant, or ask each time? Recommend: default queue with an
   inline "interrupt instead" affordance; never silently interrupt another human's turn.
7. **Does the guest see the host's _other_ connected participants' presence?** (Roster symmetry
   across three+ people.) Recommend yes — full roster to everyone; partial visibility is a lurker
   mode by another name.
8. **Naming.** "Multiplayer"? "Shared session"? "Pairing" collides with QR _pairing_ — glossary
   problem ([docs/glossary.md](../../docs/glossary.md)) to settle before UI copy exists.
   Recommend "Multiplayer" for the feature name, "participants" for people, "invite" for the
   credential; never overload "pairing".
9. **Dedicated-daemon guidance:** do we invest in a one-command "spin up a guest-safe daemon in
   Docker" flow as the recommended cross-trust-boundary answer, instead of ever building workspace
   scoping? Recommend: yes, document it in v1; decide on scoping only if real usage screams for it.

## 8. Build sequence (sketch — refine when picked up)

1. **M0 — invites + participant identity (security substrate).** Invite records + token check at
   the post-handshake gate, revocation, Settings participant list; `participant` in hello;
   device-local profile. No presence yet. Independently valuable: named, revocable device/guest
   access for the existing single-user story.
2. **M1 — presence + follow.** `PresenceService` (in-memory, coalesced roster), publish/roster
   protocol behind `features.presence`, avatar chips on workspace rows/tabs, follow mode,
   typing indicator, presence settings + master toggle. Acceptance: two devices, two profiles —
   each sees the other's focus move in <1s, follow tracks tab changes and file scroll region,
   killing one client removes it from the roster within the heartbeat window, `$OTTO_HOME` gains
   zero new files.
3. **M1.5 — read-only tier.** Deny-by-default RPC allowlist per invite tier + terminal input drop.
   Acceptance: a read-only guest can watch everything and change nothing, verified by attempting
   every mutating surface.
4. **M2 — shared steering.** (After steer-queue Phase 1.) `initiatedBy` attribution on turns and
   permission resolutions; queue-on-partner-collision default; "queued behind Sam's turn" surface.
5. **Fold-in on ship:** durable architecture → a new `docs/multiplayer.md` + threat-model deltas
   into SECURITY.md + glossary entries; delete this folder.

## Cross-cutting

- **Protocol contract:** every addition is an optional leaf or a new message type behind
  `features.presence` / `features.multiplayerInvites` — old clients parse everything, new clients
  show "Update the host" without the flags. No fallback paths.
- **Provider-agnostic by construction:** presence and attribution live entirely above the
  provider layer (session/manager), so this ships for all providers at once — no per-provider
  rollout, same as steer-queue.
- **Platform parity:** presence UI must work compact (a phone-sized roster/attribution treatment,
  per the mobile compact conventions), since "watch from your phone while your partner drives at
  a desk" _is_ the headline demo.
