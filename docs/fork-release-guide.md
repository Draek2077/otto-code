# Fork release guide (Draekz / otto-code)

This is the full account of what it takes to ship a new version of **this fork** — from bumping
a version number through to a user's desktop app auto-updating, a new Android build reaching a
phone, the marketing site going live on a domain, and a phone pairing to a daemon.

It exists because [docs/release.md](release.md) and [docs/android.md](android.md) describe the
_mechanics_ of the release process accurately, but they were written assuming upstream's accounts,
domain, and cloud projects are already wired up. This fork is a fresh identity
(`Draek2077/otto-code`) and several of those accounts don't exist yet. This doc is the map of
what's already fork-ready, what's still pointed at upstream, and what you need to create before
each capability works end to end.

Read this doc for the "what needs to exist and why." Read [docs/release.md](release.md) for the
exact command sequence once the infra below is in place, and [docs/android.md](android.md) for
Android-specific build commands.

## The two layers

Everything below splits into two layers that are easy to conflate:

1. **Infrastructure** — accounts, cloud projects, domains, secrets. You set these up once (or
   rarely). Nothing about a _release_ touches these; they're prerequisites.
2. **The release loop** — bump version, tag, push, let CI build and publish. You do this every
   time you ship. It only works to the extent the infrastructure underneath a given surface
   (desktop, Android, website) is actually pointed at your own accounts.

Right now, the **code-level pointers** (which repo the auto-updater checks, which repo owns the
Docker image, this fork's author/version identity) were repointed at `Draek2077/otto-code` on
2026-07-05. The **cloud accounts** those pointers assume (your own Cloudflare account, your own
Expo/EAS project, your own Play Console listing) mostly still need to be created — that's the
gap this doc tracks.

## Infrastructure inventory

**Update (2026-07-05):** the domain is decided — `otto-code.me` (`otto-code.ai` was too expensive) —
and so is the hosting direction: **self-host on your own local network/hardware, not Cloudflare.**
Every code-level reference to `otto-code.ai` across the repo (source, docs, nix packaging, the
rebrand-upstream tooling) has been swapped to `otto-code.me`. What follows reflects that decision.

**Correction from the first draft of this doc:** it previously said pairing "already works for your
fork as-is" by riding on upstream's relay. That's no longer true — the defaults now point at _your_
domain (`relay.otto-code.me`, `app.otto-code.me`), and nothing is deployed there, so QR pairing
fails out of the box until you deploy a relay (see "Pairing" below) or your users switch to Direct
Connection, which needs no relay at all and already works.

| Surface                                | Currently points at                                                                             | Fork-ready?                    | What you need                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo                            | `Draek2077/otto-code` (`origin`)                                                                | ✅ Yes                         | Already done                                                                                                                        |
| Desktop auto-update feed               | `Draek2077/otto-code` GitHub Releases                                                           | ✅ Yes                         | Already done (see below) — unaffected by domain/hosting choice                                                                      |
| npm packages (`@otto-code/*`)          | Unregistered scope (nobody owns it)                                                             | ⚠️ N/A                         | Not needed unless you want `npm install @otto-code/cli` to work from your fork; skip `release:publish` until/unless you set this up |
| Docker image (GHCR)                    | `ghcr.io/draek2077/otto` (dynamic owner)                                                        | ✅ Yes                         | Nothing — the workflow reads the owner from GitHub automatically                                                                    |
| Android build (EAS)                    | Expo org `otto-code-ai`, hardcoded `projectId`                                                  | ❌ No                          | Your own Expo account + your own EAS project (see "Android release" below)                                                          |
| Android package identity               | `ai.ottocode` / `ai.ottocode.debug`                                                             | ❌ No                          | A new `applicationId` — you can't reuse upstream's if it's already live on the Play Store                                           |
| Play Store listing                     | N/A (not created)                                                                               | ❌ No                          | Your own Google Play Console developer account ($25 one-time)                                                                       |
| Push notifications (FCM)               | Firebase project tied to `ai.ottocode`                                                          | ❌ No                          | Your own Firebase project + `google-services.json`, once you have your own package ID                                               |
| **Daemon + web UI (the app itself)**   | Your own home server, once you enable `--web-ui`                                                | ✅ Ready, just needs enabling  | Nothing new — built into the daemon. See "Local network hosting" below.                                                             |
| Domain (`otto-code.me`)                | Decided; DNS not yet pointed anywhere                                                           | ⚠️ In progress                 | Point it at your home network — see "Local network hosting" below                                                                   |
| Marketing website (`packages/website`) | Cloudflare Workers, upstream's account                                                          | ❌ Not started, optional       | Separate from "hosting Otto" — see "Marketing website" below for why it's lower priority and still Cloudflare-coupled               |
| QR-code pairing (relay-based)          | Defaults to `relay.otto-code.me` / `app.otto-code.me` — unreachable, nothing deployed there yet | ❌ Currently broken by default | Relay only ships a Cloudflare Workers (Durable Objects) adapter — no plain self-hosted relay exists. See "Pairing" below.           |
| Direct connection (no relay, no QR)    | Works today, zero cloud dependency                                                              | ✅ Yes                         | Nothing — host/port/password against your own daemon, works over LAN or your domain once exposed                                    |
| macOS code signing                     | N/A (not configured)                                                                            | N/A                            | Apple Developer Program ($99/yr) + certs as GH secrets, only if you want signed/notarized Mac builds                                |
| Windows code signing                   | N/A (ships unsigned)                                                                            | N/A                            | Optional; unsigned Windows builds just show a SmartScreen warning on first run                                                      |

## Versioning

Covered in full by [docs/release.md](release.md); the short version:

- All workspace packages share one version (root `package.json`). `npm run version:all:patch`
  bumps it, syncs every workspace package, commits, and tags.
- **Routine releases are always a patch bump** — `0.3.0` → `0.3.1` — regardless of whether the
  change was a feature or a fix. Minor/major bumps are reserved for deliberate large milestones
  and only happen when you explicitly say so.
- A beta line (`X.Y.Z-beta.N`) exists if you want to smoke-test a build yourself before it goes
  out widely: `release:beta:patch` → iterate with `release:beta:next` → `release:promote` to cut
  the matching stable release.
- To jump to an arbitrary version (like the `0.1.104-beta.2` → `0.3.0` renumbering), skip the
  bump-mode scripts and run `npm version <exact> --include-workspace-root --message "chore(release): cut %s"`
  directly — same lifecycle hook, just an explicit target instead of a computed one.

## Desktop release & auto-update

**Already fork-ready.** This is the one surface where the plumbing fully points at your own repo:

- `packages/desktop/electron-builder.yml` → `publish.owner: Draek2077`, `publish.repo: otto-code`.
  This is what Electron's `autoUpdater` reads to find new releases.
- `packages/app/src/desktop/updates/desktop-updates.ts` → `RELEASE_DOWNLOAD_BASE_URL` points at
  `github.com/Draek2077/otto-code/releases/download` (the manual "download the new DMG" link).
- `package.json` → `repository.url` points at `Draek2077/otto-code.git`.

The release loop, once you're ready to ship:

1. `npm run version:all:patch` (bump, commit, tag) — or the beta flow if you want to test first.
2. Push the branch and the tag: `git push && git push --tags`.
3. The tag push triggers `.github/workflows/desktop-release.yml` in **your** repo, which builds
   macOS/Linux/Windows installers and publishes them as a GitHub Release with a staged 36-hour
   rollout (`rolloutHours`, ramping 0%→100%).
4. Installed apps poll every 30 minutes and pick up the new release automatically once admitted
   by the rollout; a manual "Check for Updates" click bypasses the rollout entirely.

**Two gaps to know about:**

- **macOS builds will fail as-is.** `electron-builder.yml`'s `mac:` section has `notarize: true`
  unconditionally, and the workflow expects `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` as GitHub secrets. Without an Apple
  Developer Program membership and those secrets configured on `Draek2077/otto-code`, the
  `publish-macos` job will fail. Windows and Linux builds have no such requirement and ship
  unsigned (Windows shows a SmartScreen warning on first run; that's normal for unsigned installers).
- **npm publish will fail, and that's fine to skip.** `npm run release:patch` also runs
  `npm run release:publish`, which tries to publish `@otto-code/server`, `@otto-code/cli`, etc. to
  the public npm registry. That scope isn't registered to anyone, so this step 404s. Either run
  `npm run version:all:patch` directly instead of the full `release:patch` chain (skips publish
  entirely), or register your own npm org and repoint `package.json`'s `name` fields if you
  eventually want `npm install` to work from your fork.

## Android release

**This needs new infrastructure before it works at all**, because Android builds go through EAS
(Expo Application Services), which is a hosted build service tied to an Expo account — not your
GitHub repo. Two things in `packages/app` currently point at upstream's Expo org:

```js
// packages/app/app.config.js
extra: { eas: { projectId: "0e7f65ce-0367-46c8-a238-2b65963d235a" } },
owner: "otto-code-ai",
```

You don't have permission to build against that project, so `eas build` will fail for you as-is.

### Setup (one-time)

1. Create your own Expo account at expo.dev if you don't have one.
2. From `packages/app`, run `npx eas init` (or `npx eas project:init`). This creates a fresh EAS
   project under **your** account and gives you a new `projectId`.
3. Update `packages/app/app.config.js`:
   - `owner:` → your Expo username or org.
   - `extra.eas.projectId` → the new project ID from step 2.
4. **Pick a new Android `applicationId`.** `docs/android.md` documents the current IDs as
   `ai.ottocode` (production) and `ai.ottocode.debug` (development) — controlled by
   `APP_VARIANT` in `app.config.js`. Play Store package names are globally unique and permanent
   once published; if upstream ever ships `ai.ottocode` to the Play Store (or already has), you
   cannot reuse it. Pick something under your own namespake, e.g. `com.draekz.ottocode`.
5. If you want an Expo-token-authenticated CI build (via
   `.github/workflows/android-apk-release.yml`), add an `EXPO_TOKEN` secret to your GitHub repo
   (Settings → Secrets → Actions) generated from your Expo account.
6. If you want push notifications to work, create your own Firebase project scoped to your new
   `applicationId` and supply `google-services.json` per `packages/app/app.config.js`'s
   `googleServicesFile` resolution (env var or `.secrets/google-services.prod.json`).

### Two distribution paths

You said "at least Android for now" — here are the two ways to get a build to a phone, in order
of how much infrastructure each needs:

**A. GitHub Release APK, no Play Store (least infra).** Push a `vX.Y.Z` or `android-vX.Y.Z` tag;
`.github/workflows/android-apk-release.yml` builds via EAS's `production-apk` profile (internal
distribution, not submitted anywhere) and attaches the APK to the GitHub Release. Users
sideload it directly. Still needs your own EAS project (step 1-3 above) and `EXPO_TOKEN`, but
skips the Play Console entirely — no $25 fee, no store review, no `eas submit` credentials.

**B. Play Store (full infra).** Additionally requires a Google Play Console developer account
($25 one-time) and `eas submit` credentials (EAS-managed, no separate keystore juggling needed —
EAS handles Play Store credentials once you link the Play Console account). `eas.json`'s
`submit.production.android` is already configured to auto-submit to the `production` track on a
stable tag push; you'd point it at your own listing once the Play Console app exists.

There's also a **zero-infrastructure fallback** for a quick local test build: `npm run
android:production` from the repo root builds and installs a release APK directly to a connected
device/emulator with no EAS account at all (see [docs/android.md](android.md)). Good for smoke-testing
before you've set up EAS; not a distribution mechanism for other users.

## Local network hosting (recommended path)

This is the fastest path to "otto-code.me does something useful," and needs **zero cloud
accounts**. The daemon can serve its own web UI directly — that IS the "web app" — and the
mobile/desktop apps can connect to it directly, no relay involved.

### 1. Enable the web UI and expose it beyond localhost

```bash
OTTO_PASSWORD=your-secret otto daemon start --web-ui --listen 0.0.0.0:6868 --hostnames ".otto-code.me"
```

- `--web-ui` serves the full browser app from the daemon's own HTTP server.
- `--listen 0.0.0.0:6868` binds beyond `127.0.0.1` so other devices can reach it — **do this only
  after** setting a password.
- `OTTO_PASSWORD` protects the API/WebSocket (the static page itself loads without it, by design,
  so the login screen can render).
- `--hostnames ".otto-code.me"` adds your domain to the DNS-rebinding allowlist; without it every
  request through your domain gets `403 Invalid Host header`.

Persist these in `~/.otto/config.json` so they survive restarts — see
[public-docs/web-ui.md](../public-docs/web-ui.md) for the config-file form of each flag.

### 2. Get otto-code.me reachable from outside your LAN

Three options, in order of how much you have to manage yourself:

**A. Cloudflare Tunnel (recommended).** No port forwarding, no dynamic-DNS script, works even
behind CGNAT. Your compute stays entirely on your own hardware — Cloudflare only relays the
connection, it doesn't run anything of yours.

```bash
cloudflared tunnel --url http://localhost:6868
```

Cloudflare terminates TLS and sets `X-Forwarded-Proto: https` for you, so the app's auto-connect
to `wss://` works with no extra daemon config. For a persistent setup (not the quick ad-hoc
command above), create a named tunnel and map it to `otto-code.me` in the Cloudflare dashboard —
this requires adding your domain to a free Cloudflare account, but you are not deploying any
Workers or paying for compute; Cloudflare is acting purely as ingress.

**B. Port forward + Dynamic DNS + reverse proxy.** Fully independent of any third party. Needs:
your router forwarding port 443 to your server, a DDNS client (many routers have one built in, or
use a service like DuckDNS/No-IP) since home ISPs usually hand out dynamic IPs, and a reverse
proxy for TLS. [Caddy](https://caddyserver.com) is the least config:

```caddy
otto-code.me {
  reverse_proxy 127.0.0.1:6868
}
```

Caddy auto-provisions a Let's Encrypt cert and forwards WebSocket upgrades and headers correctly
by default. See [public-docs/web-ui.md](../public-docs/web-ui.md) for the equivalent Nginx config
and the exact headers a proxy must forward (`Host`, `X-Forwarded-Proto`, WebSocket `Upgrade`).

**C. Static IP, if your ISP gives you one.** Skip DDNS, point an `A` record at it directly, same
reverse proxy setup as B.

**Tailscale** is worth mentioning even though it doesn't use your domain: `tailscale serve https /
http://127.0.0.1:6868` puts the daemon on your private tailnet with zero public exposure and TLS
handled for you — a good option if "reachable from your phone" doesn't need to mean "reachable
from the public internet."

### 3. Connect from a phone: Direct Connection, not QR

Once otto-code.me resolves to your server (or you're just testing over LAN), add the host from
the mobile app using **Direct Connection** (`packages/app/src/components/add-host-modal.tsx`) —
host, port, TLS toggle, password. This is a separate, relay-free path from the QR/pairing-link
flow (see "Pairing" below for why QR doesn't Just Work here) and needs nothing beyond what you
just set up:

- Host: `otto-code.me` (or the LAN IP for local-only testing)
- Port: `443` (or `6868` for a plain LAN connection without a reverse proxy)
- TLS: on, once behind Caddy/Cloudflare Tunnel; off for a bare LAN `otto daemon start --web-ui
--listen 0.0.0.0:6868` with no proxy
- Password: whatever you set via `OTTO_PASSWORD`

This already fully satisfies "show the website" (the daemon-served UI is the app) and works
end-to-end today, with nothing left to build.

## Pairing (QR code vs. direct)

What you described as "register via QR code as well as direct" maps to two genuinely different
mechanisms in the app, not two presentations of the same thing (an earlier draft of this doc got
this wrong):

- **QR scan / paste-link** (`add-host-method-modal.tsx`'s "Scan QR" and "Paste Link" options) —
  both consume the same relay-based **pairing offer** URL
  (`packages/server/src/server/pairing-offer.ts`): the daemon encodes its public key and a relay
  endpoint into a URL fragment (`https://app.otto-code.me/#offer=...`), optionally rendered as a
  QR code.
- **Direct Connection** (`add-host-modal.tsx`, described above) — a manual host/port/TLS/password
  form. No relay, no offer URL, no QR. Already works today with the setup above.

**The QR/pairing-offer path needs a relay, and this repo only ships one relay implementation:**
`packages/relay`'s Cloudflare Durable Objects adapter. This is confirmed by the project's own nix
packaging (`nix/module.nix`): `relay.mode = "hosted"` uses the default relay, `relay.mode =
"remote"` points at a relay you deployed yourself (still has to be a Cloudflare Worker — that's
the only adapter that exists), and a `"local"` mode (a plain relay process on your own host) is
explicitly **not yet implemented** in this codebase. So a fully-local-only relay isn't something
you can configure your way into — it doesn't exist yet.

Given "self-host on my local network," you have three real choices, cheapest first:

1. **Skip QR pairing, use Direct Connection.** Zero infrastructure, works today (see above). This
   is what's recommended for now, since it fully satisfies your stated goals without any cloud
   dependency.
2. **Deploy just the relay to Cloudflare's free tier**, keeping everything else (daemon, web UI)
   on your own hardware. Durable Objects with the SQLite storage backend are available on
   Cloudflare's free plan, so this is a $0 coordination layer, not a hosting commitment:
   - Get a free Cloudflare account, add `otto-code.me` to it (or just a `relay.otto-code.me`
     subdomain, doesn't require moving your whole DNS there).
   - Deploy `packages/relay`: update `packages/relay/wrangler.toml`'s `account_id` to yours and
     `routes` to `relay.otto-code.me`, then `npm run build --workspace=@otto-code/relay && wrangler
deploy` from `packages/relay`.
   - Point the daemon at it — no code changes needed, `packages/server/src/server/config.ts`
     already reads these env vars:
     - `OTTO_RELAY_ENDPOINT` / `OTTO_RELAY_PUBLIC_ENDPOINT` → `relay.otto-code.me:443`
     - `OTTO_RELAY_USE_TLS` / `OTTO_RELAY_PUBLIC_USE_TLS` → `true`
     - `OTTO_APP_BASE_URL` → `https://otto-code.me` (or wherever you serve the pairing landing
       page — see below)
   - QR pairing needs somewhere to land when scanned/opened: either a tiny static redirect page you
     host, or (simplest) point `appBaseUrl` at your own daemon's web UI directly, since it already
     handles the `#offer=...` fragment the same way `app.otto-code.me` would.
   - See [SECURITY.md](../SECURITY.md) for the relay's E2E encryption/threat model before doing this.
3. **Build a "Show as QR" feature for Direct Connection** (not yet implemented, but small). The
   `qrcode` npm package is already a dependency and already used for the relay-based pairing flow
   (`pair-device-section.tsx`). Encoding the same host/port/password URI
   (`serializeConnectionUriForStorage` in `packages/protocol/src/daemon-endpoints.ts`) into a QR
   code for the Direct Connection form would give you scan-to-connect on your LAN with zero relay
   dependency. This is a real, scoped feature addition — say the word if you want it built.

## Marketing website (optional, separate from hosting Otto)

`packages/website` — the `otto-code.me` landing page, docs, download links, changelog — is **not**
required for the daemon, pairing, or updates to work. It's informational content, and it's tightly
coupled to Cloudflare Workers today (`@cloudflare/vite-plugin`, a KV namespace for caching, a
Workers `fetch` handler as its entry point in `packages/website/src/server-entry.ts`), which cuts
against "everything on my local network."

Given that coupling, porting it to run as a plain Node process on your own hardware is a real
side-project (swapping the Cloudflare adapter for TanStack Start's Node preset, replacing the KV
cache), not a config change. Given you said "for now," the pragmatic options are:

1. **Skip it for now.** Your daemon's own web UI (see above) already covers "show something at
   otto-code.me." The marketing site is polish, not function.
2. **Deploy it to Cloudflare's free tier anyway**, separately from your local-hosting goal for the
   daemon itself — it's just static-ish content, doesn't need to be "local," and costs nothing:
   same pattern as the relay, update `packages/website/wrangler.toml`'s `account_id`/`routes`,
   add `CLOUDFLARE_API_TOKEN` as a repo secret, push.
3. **Port it to Node hosting** if you want it truly on your own hardware — flag this if you want
   it scoped as its own task; it's not a quick add.

## Domain

`otto-code.me` is decided. Everything that referenced `otto-code.ai` across source, docs, nix
packaging, and the upstream-merge rebrand tooling (`scripts/rebrand-upstream.pl`,
`docs/upstream-merges.md`) has already been swapped in this pass — future `git merge
upstream/main` runs will rebrand new Paseo code straight to `otto-code.me` / `Draek2077/otto-code`
without drifting back. What's left is entirely DNS/hosting, covered above:

- Point `otto-code.me` at your Cloudflare Tunnel, or your home IP/DDNS hostname (reverse-proxy
  path), depending which option you pick in "Local network hosting."
- If you later deploy the relay or the marketing site to Cloudflare, that's a `relay.otto-code.me`
  / `otto-code.me` (or a subdomain) custom-domain binding inside Cloudflare, independent of how the
  root domain's DNS is otherwise managed.

## Full release checklist

Pulling the above into one end-to-end runbook for "ship a new version":

- [ ] Working tree clean, on `main`, format/lint/typecheck all green
- [ ] Decide patch vs. beta (see "Versioning" above)
- [ ] `npm run version:all:patch` (or `release:beta:patch` for a beta) — bumps, commits, tags
- [ ] `git push && git push --tags`
- [ ] **Desktop**: confirm `Desktop Release` workflow is green for Windows/Linux (and macOS, if
      Apple signing is set up) on the new tag
- [ ] **Android**: confirm `Android APK Release` workflow is green (once EAS project + `EXPO_TOKEN`
      are set up per "Android release" above); confirm Play Store submission separately if you're
      using that path
- [ ] **Website**: confirm `Deploy Website` ran on the published release (once Cloudflare account + `CLOUDFLARE_API_TOKEN` are set up)
- [ ] **Docker**: confirm the `Docker` workflow published `ghcr.io/Draek2077/otto:X.Y.Z` (works
      automatically, no setup needed)
- [ ] Spot-check the changelog entry rendered correctly on the GitHub Release body

## What's genuinely not decided yet

Being explicit about the open questions rather than picking answers for you:

- **Domain name** — in progress on your end.
- **Whether to self-host the relay** or keep riding on `relay.otto-code.ai` — works either way
  right now; only matters if full infrastructure independence is a goal.
- **Whether to pursue Play Store distribution** or stick with GitHub-Release APKs — Play Store
  needs the $25 developer account and a store listing (screenshots, privacy policy, content
  rating) that don't exist yet; APK-only is live-able much faster.
- **Whether to publish `@otto-code/*` packages to npm** under your own scope — not needed unless
  you want `npm install` to work from source packages directly.
- **macOS code signing** — needs an Apple Developer Program membership; without it, scope releases
  to Windows/Linux (and Android) until/unless you decide it's worth $99/year.
