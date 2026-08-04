# Relay `role=server` connections are unauthenticated

**Date:** 2026-08-02
**Question:** A security audit claimed `packages/relay/src/cloudflare-adapter.ts` routes connections on
query parameters alone, so anyone holding a `serverId` can seize the daemon's control socket and deny
remote access. Does the finding hold, what is the real severity, and what is the smallest fix that
actually closes it?

This report is the audit trail. Whatever we decide to build about it is a row in
[`projects/README.md`](../../projects/README.md), not here.

---

## Short answer

**The finding holds.** A peer that connects with `?serverId=<known>&role=server&v=2` (no
`connectionId`) is accepted as the daemon's control socket, and the Durable Object closes the
incumbent control socket with code `1008` before accepting it. No signature, token, or key check
runs anywhere in the upgrade path. `rg -n "signature|verify|sign" packages/relay/src/cloudflare-adapter.ts`
returns nothing.

**But the severity is remote-access denial, not daemon takeover.** The end-to-end encryption boundary
described in `SECURITY.md` holds exactly as written: an attacker who seizes the socket still cannot
read or forge a single application message, because every one is sealed under a NaCl `box` shared key
that requires the daemon's secret key to derive. The practical impact is: an attacker who knows a
`serverId` can stop the phone from reaching the daemon over the relay, indefinitely. They cannot
become the daemon.

The one uncomfortable structural fact, spelled out under "Why the cheap fix does not close it" below:
because the relay has no way to tell the real daemon from an impostor, **every eviction policy just
chooses which race the attacker has to win.** Only binding the socket to the daemon's key actually
removes the hole, and that is the expensive, protocol-touching change.

---

## What the code actually does

### The upgrade routes on query parameters only

`fetch()` reads `role`, `serverId`, `connectionId`, `v` straight off the query string and validates
only their _shape_, never the caller's identity (`cloudflare-adapter.ts:417-443`):

```ts
const roleRaw = url.searchParams.get("role");
const role = roleRaw === "server" || roleRaw === "client" ? roleRaw : null;
const serverId = url.searchParams.get("serverId");
...
if (!serverId) return new Response("Missing serverId parameter", { status: 400 });
...
return this.fetchV2(request, role, serverId, connectionId);
```

### A second `role=server` control socket evicts the incumbent

In `fetchV2`, `isServerControl` is derived purely from "role is server and there is no connectionId",
then `closeExistingServerSockets` closes whatever control socket is already attached
(`cloudflare-adapter.ts:353-360`, `181-195`):

```ts
const isServerControl = role === "server" && !resolvedConnectionId;
const isServerData = role === "server" && !!resolvedConnectionId;
this.closeExistingServerSockets({ isServerControl, isServerData, resolvedConnectionId });
```

```ts
private closeExistingServerSockets(args: {...}): void {
  if (args.isServerControl) {
    for (const ws of this.state.getWebSockets("server-control")) {
      ws.close(1008, "Replaced by new connection");   // <- incumbent daemon kicked
    }
  } else if (args.isServerData) {
    for (const ws of this.state.getWebSockets(`server:${args.resolvedConnectionId}`)) {
      ws.close(1008, "Replaced by new connection");   // <- per-connection socket kicked
    }
  }
}
```

The v1 path does the same thing unconditionally (`cloudflare-adapter.ts:317-319`). So the answer to
"is the incumbent evicted or is the newcomer rejected?" is: **the incumbent is evicted, the newcomer
always wins.**

### The eviction is deliberate, and the daemon depends on it

This is not an oversight - it is how the daemon reconnects. When the daemon's control socket
half-opens, the daemon terminates it and dials a fresh one (`relay-transport.ts:214-260`,
`333-343`), and that fresh socket must be allowed to _replace_ the stale one. `getWebSockets` under
Cloudflare hibernation cannot tell a live socket from a zombie, so the DO takes the simple route:
the newest server socket always wins. That correctness requirement is exactly what makes the naive
"just reject the newcomer" fix unsafe (see below).

### The reconnect loop, quantified from the code

- Attacker connects `role=server` → DO closes the real daemon's control socket with `1008`.
- Daemon observes `close` and calls `scheduleReconnect()` with backoff
  `delayMs = Math.min(30000, 1000 * reconnectAttempt)` (`relay-transport.ts:333-343`) - 1s, 2s, 3s…
  capped at 30s.
- Each time the daemon reconnects it re-evicts the attacker, and the attacker re-evicts it with no
  backoff at all.

The attacker reconnects instantly in a loop; the daemon backs off toward a 30s cadence. The attacker
wins the race by construction, so the daemon spends almost all of its time evicted. While it is
evicted, client data sockets for that session are force-closed too (`webSocketClose`,
`cloudflare-adapter.ts:549-558`, closes the paired client with `1012`). Net effect: **sustained
denial of remote access for anyone holding the `serverId`.**

---

## Why this is denial-of-service, not takeover - establishing the boundary precisely

The task asked for this boundary to be pinned down, because it decides the severity.

The control channel the attacker seizes carries only relay bookkeeping - `sync`, `connected`,
`disconnected`, `ping`, `pong` (`relay-transport.ts:49-54`). Seizing it grants no application
authority. Suppose the attacker goes further and also opens the per-connection data socket
(`role=server&connectionId=X`) to intercept a client's frames. Trace the handshake
(`encrypted-channel.ts`):

1. The client derives its shared key from **the daemon's public key** (carried in the pairing link)
   and its own ephemeral secret: `deriveSharedKey(clientSecret, daemonPublic)`
   (`createClientChannel`, `encrypted-channel.ts:154-161`). It then sends a plaintext `e2ee_hello`
   carrying only its ephemeral public key.
2. The attacker can reply `e2ee_ready` - it is plaintext and needs no key - so the client's channel
   flips to `open` and starts sending application traffic **encrypted under a key the attacker cannot
   derive** (it would need the daemon's secret key, `deriveSharedKey(daemonSecret, clientPublic)`,
   `createDaemonChannel`, `encrypted-channel.ts:274-275`).
3. So the attacker cannot **read** the client's frames (they fail `nacl.box.open`, `crypto.ts:142-155`)
   and cannot **forge** frames the client will accept (any ciphertext it sends fails authenticated
   decryption on the phone and the channel closes, `encrypted-channel.ts:448-459`).

`encrypted-channel.ts:503-531` even hardens the reconnect case: a _different_ client key presented on
an already-open daemon channel is rejected with `1008` rather than silently re-keyed, so the relay
cannot swap a live channel onto an attacker-chosen key.

**Conclusion:** the attacker gets availability denial plus the metadata the relay already sees
(IP, timing, sizes, connectionIds, the plaintext handshake). Confidentiality and integrity are
intact. This matches `SECURITY.md`'s "Relay threat model" exactly - the relay is untrusted by design
and the E2EE holds even if it is fully compromised.

### `serverId` is not a secret, and knowing it is the whole prerequisite

`serverId` is a random 12-char token (`server-id.ts:23-27`), stored separately from the keypair. It
travels in the pairing offer fragment **alongside** the daemon public key
(`connection-offer.ts:34-41`, `pairing-offer.ts:41-46`) and is registered with the hub together with
the public key (`bootstrap.ts:1615-1616`). Anyone who has ever received a pairing link has both the
`serverId` and the public key. The audit's premise - that a `serverId` is enough to grief the relay -
is correct. The public key travelling with it does **not** help an attacker forge anything (it is
public by design), but it _does_ matter for the fix, because a signature scheme needs a way to know
which key to check against (see Option B).

---

## Does `SECURITY.md` over-claim?

No - and this is worth stating precisely, because "the doc claims a protection the code lacks" would
be a finding in its own right. It does not. `SECURITY.md` is careful to scope its guarantees to
**confidentiality and integrity** ("cannot read your messages, see your code, or modify traffic
without detection"), and it never claims the relay resists denial of service or that `serverId`
authenticates the daemon. Its trust-anchor section says to treat the pairing link "like a password."

The gap is one of **silence, not falsehood**: the document does not mention that a leaked `serverId`
lets a third party deny relay access (without ever breaching E2EE). That is a small, honest
documentation improvement, not a correction of a wrong claim. Recommended wording is in the appendix.

---

## Why the cheap fix does not close it

The tempting minimal fix is "refuse to evict a live incumbent" - flip the worst case from "attacker
displaces the daemon" to "attacker cannot connect." It is not that simple, for two compounding
reasons:

1. **The DO cannot tell a live incumbent from a zombie.** Under hibernation, `ws.send` may succeed to
   a dead peer and protocol pings are answered at the edge without waking the DO. That is precisely
   why the current code evicts unconditionally. A blanket "reject the newcomer" rule breaks the
   daemon's own reconnect after a half-open socket: the daemon dials a fresh control socket and the DO
   turns it away because it still believes the zombie is alive. Reconnect would stall until the dead
   socket's `close` finally surfaces (up to the ~30s stale timeout), regressing a real, common path.

2. **Even done perfectly, it only swaps which race the attacker must win.** Because the relay has no
   identity for the daemon, the two policies are symmetric:
   - _Evict-on-newcomer_ (today): last to connect wins → attacker wins by reconnecting in a loop.
   - _Reject-newcomer_: first to connect wins → attacker wins by connecting during any daemon restart
     and then simply **holding** the socket open forever, which the DO can never reclaim.

   The second is arguably worse: it converts a noisy, self-healing eviction storm into a quiet,
   permanent squat that survives until someone notices.

The load-bearing conclusion: **without cryptographic identity, no eviction policy is secure.** The
only real fix binds the control socket to possession of the daemon's secret key.

---

## Options

### Option A - Report upstream, patch nothing here (recommended default)

`packages/relay/` is pristine upstream Paseo. Per `CLAUDE.md`, it is the single most merge-expensive
place in this repo to touch, and a relay protocol change must be deployed in lockstep with clients.
This vulnerability is upstream's, the fix belongs in the upstream protocol, and the severity
(availability of the _optional_ relay path; direct and local connections are unaffected; E2EE intact)
does not force a local hotfix.

- **Merge cost:** zero. No local diff to carry across every future Paseo merge.
- **Deploy cost:** none by us; we do not run the live relay change.
- **Residual risk while unpatched:** a party holding a `serverId` can deny that daemon's relay access.
  Mitigations available to a user today without any code change: rotate `serverId` (delete
  `$OTTO_HOME/server-id`, re-pair), or use a direct/tunnel connection with `OTTO_PASSWORD` instead of
  the relay.
- **What we do:** file a report to the Paseo project describing the eviction DoS and the
  identity-binding fix (Option B), and add a `projects/README.md` row tracking it as
  "reported upstream, awaiting fix."

### Option B - Bind the control socket to the daemon key (the real fix; upstream-shaped)

Require `role=server` upgrades to prove possession of the daemon's secret key, and reject the upgrade
in the Worker/DO otherwise. The audit's one-line sketch ("detached signature over
`serverId || timestamp || connectionId`, verified against the published public key") is the right
shape but under-specified in two ways that dominate the design:

1. **The daemon keypair is an X25519 `box` keypair, not a signing key.** `crypto.ts` uses
   `nacl.box` (Curve25519 key agreement). tweetnacl will not sign with a `box` secret key, and there
   is no clean X25519→Ed25519 signing conversion. So "sign with the daemon keypair" requires
   introducing a **new Ed25519 signing key**, published in the pairing offer and stored beside
   `daemon-keypair.json`. Cloudflare Workers' WebCrypto verifies Ed25519 cheaply
   (`crypto.subtle.verify` with `Ed25519`), so the verify side is fine; the cost is the new key and
   getting it into the offer/hub/storage.

2. **`serverId` is not derived from any key, so the Worker does not know which key to trust.** A
   signature verified against a _presented_ key proves nothing - the attacker presents their own key
   and signs with it. The Worker needs the _expected_ key for that `serverId`. Two ways to supply it:
   - **TOFU in DO storage:** the first `role=server` connection for a `serverId` binds its public key
     in the Durable Object's durable storage; every later `role=server` upgrade must carry a signature
     verifiable against the bound key. The legit daemon (holding the secret key) always passes; an
     impostor (no secret key) always fails; reconnect works because it is the same key. Residual: an
     attacker who binds _first_, before the daemon ever connects for that `serverId`, wins - a much
     narrower window than today, and closable by seeding the binding from the hub registration.
   - **Self-certifying `serverId`:** make `serverId` an encoding of (a hash of) the signing public
     key, so the Worker verifies against the key embedded in the id with **no stored state and no TOFU
     race**. Cleanest cryptographically, but it changes the `serverId` format and therefore breaks
     every stored pairing link, offer, and hub relationship that persists a `serverId`. Too expensive
     for this fork; note it only as the clean-slate upstream design.

   Replay/skew: sign a monotonic timestamp and have the DO reject non-increasing timestamps per
   `serverId` (it already has durable storage), bounding replay to nothing. Skew tolerance of ±60s is
   ample; daemon and edge both run NTP. Note replay is a weak threat regardless - the upgrade rides
   TLS to the relay, so an off-path attacker cannot capture a signature to replay; the real threat is
   an attacker who has `serverId` + public key but not the secret key, and they cannot sign at all.

   Rollout: gate behind a `server_info.features.*` capability per the fork's compat rule; old daemons
   connect unsigned and the DO must accept them until the floor moves, which means the DoS stays open
   during the transition. This is inherent to a lockstep protocol change and is another reason it
   belongs upstream where the client/daemon/relay floor is managed together.

- **Merge cost (if landed in this fork):** high and permanent - it touches the pristine relay plus the
  daemon key storage, the connection offer, and the client, and every one of those relay hunks
  re-conflicts on each Paseo merge.
- **Deploy cost:** must deploy the relay Worker and ship matching daemon/client in step.

### Option C - Narrow the window locally without protocol change (interim, partial)

If there is product urgency to reduce the blast radius before upstream fixes it, the _only_ honest
local change is to make eviction cheaper for the daemon to win and harder to sustain - e.g. rate-limit
how often a given `serverId`'s control socket may be replaced, or add a short "settling" grace so a
just-connected control cannot be evicted for N seconds. This raises the attacker's cost (they must
reconnect continuously and still only get intermittent denial) without claiming to close the hole.

- **Merge cost:** small but non-zero, and it is a diff against the pristine relay that we then carry
  forever. Given it does **not** actually fix the vulnerability (per "Why the cheap fix does not close
  it"), the carrying cost is hard to justify.
- **Recommendation:** do not do this unless a concrete incident forces it. It buys degraded-DoS for
  permanent merge tax.

---

## Recommendation

1. **Confirm and record the severity as remote-access denial (availability), not takeover.** The
   E2EE boundary holds; `SECURITY.md`'s confidentiality/integrity guarantees are accurate.
2. **Report the vulnerability and the Option B design upstream to Paseo.** That is where a relay
   protocol change should live, and the fork's merge discipline argues strongly against carrying a
   relay diff.
3. **Do not land a protocol change in this fork.** Patch the relay locally only if a real incident
   forces it, and if so prefer Option C's window-narrowing (explicitly labelled a mitigation, not a
   fix) over a half-built signature scheme.
4. **Make the one-sentence `SECURITY.md` addition** noting that a leaked `serverId` allows relay-access
   denial without breaching E2EE (appendix). This is a doc-only change, no protocol impact, safe to
   land here.
5. **Track it as a row in `projects/README.md`** ("relay role auth - reported upstream") rather than
   as status in this findings file.

No implementation code was written, per the instruction to get agreement on any protocol change first.

---

## Method / reproduction

Read in full: `packages/relay/src/cloudflare-adapter.ts`, `e2ee.ts`, `crypto.ts`,
`encrypted-channel.ts`, `packages/server/src/server/relay-transport.ts`, `SECURITY.md`. Traced
`serverId` generation (`server-id.ts`), its placement in the offer (`connection-offer.ts`,
`pairing-offer.ts`) and hub registration (`bootstrap.ts:1615-1616`). Confirmed the absence of any
identity check with `rg -n "signature|verify|sign" packages/relay/src/cloudflare-adapter.ts` (no
matches). Eviction behavior read directly from `closeExistingServerSockets` and the v1/v2 paths;
reconnect/backoff dynamics from `relay-transport.ts:333-343`. E2EE boundary walked through
`createClientChannel` / `createDaemonChannel` / `handleDaemonRehello`. No live relay was contacted and
nothing was deployed.

---

## Appendix - proposed `SECURITY.md` sentence

To add at the end of the "Relay threat model" → "Why the relay can't attack you" list (framed as a
scope note, since the surrounding guarantees are about confidentiality and integrity):

> - **Deny you access** - a party who obtains your `serverId` (it travels in the pairing link) can
>   disrupt the relay path and prevent your phone from reaching the daemon. This is a denial of
>   availability only: it cannot read, forge, or inject application traffic, which remains end-to-end
>   encrypted. Rotate the pairing link, or use a direct connection with a password, if you suspect a
>   link has leaked.
