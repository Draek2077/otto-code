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

**Update (2026-07-08): Cloudflare is live — this superseded the self-host direction.** A
`CLOUDFLARE_API_TOKEN` repo secret was added on 2026-07-05, both `wrangler.toml`s carry the
fork's own `account_id` with `otto-code.me` routes, and as of the v0.4.2 release the
`Deploy Website` (marketing site, Workers), `Deploy Relay` (`relay.otto-code.me`, Workers), and
`Deploy App` (`otto-app` Cloudflare Pages project, on stable `v*` tags) workflows all run green.
That means the relay-based QR pairing infrastructure (relay + app base URL) is deployed —
earlier statements in this doc that "nothing is deployed there" and that hosting would be
local-only are **stale**; the "Local network hosting" section below remains valid as an
alternative, not the current state. (Amended 2026-07-11: `app.otto-code.me`'s one-time
custom-domain attach was missing until this date; now done — see "Web app custom domain" below.)

**Update (2026-07-11): npm is live.** The `otto-code` npm org exists (owner `draek2077`) and all
six `@otto-code/*` packages were first published at 0.5.0 — `release:publish` is now a normal
part of the release chain.

**Update (2026-07-12): Google Play internal-track auto-submit is wired.** The `Android Play
Release` workflow (`.github/workflows/android-play-release.yml`) builds an AAB via EAS and submits
it to the Play **internal testing** track on a `v*` tag — the automated replacement for
hand-uploading the AAB. The two one-time Google setups it needs (enable the Android Publisher API;
grant the service account release permission in the Play Console) were both completed during 0.5.1.
See "Android release → Play internal-track auto-submit" below. 0.5.1's submit was ultimately done
by hand (so a versionCode already existed and `eas submit` rejected the duplicate), so the
automation first runs fully end-to-end on 0.5.2.

**Update (2026-07-05):** the domain is decided — `otto-code.me` (`otto-code.ai` was too expensive).
Every code-level reference to `otto-code.ai` across the repo (source, docs, nix packaging, the
rebrand-upstream tooling) has been swapped to `otto-code.me`.

| Surface                                | Currently points at                                                                                                        | Fork-ready?                   | What you need                                                                                                                                                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo                            | `Draek2077/otto-code` (`origin`)                                                                                           | ✅ Yes                        | Already done                                                                                                                                                                                                                          |
| Desktop auto-update feed               | `Draek2077/otto-code` GitHub Releases                                                                                      | ✅ Yes                        | Already done (see below) — unaffected by domain/hosting choice                                                                                                                                                                        |
| npm packages (`@otto-code/*`)          | npm org `otto-code` (owner `draek2077`); all six packages published at 0.5.0 on 2026-07-11                                 | ✅ Yes                        | Nothing — `release:publish` is part of the normal release chain now; stay logged in as an org member                                                                                                                                  |
| Docker image (GHCR)                    | `ghcr.io/draek2077/otto` (dynamic owner)                                                                                   | ✅ Yes                        | Nothing — the workflow reads the owner from GitHub automatically                                                                                                                                                                      |
| Android build (EAS)                    | Expo org `otto-code`, `projectId 69eddb63-f77d-413a-b2b7-ed83e8e16759`, `EXPO_TOKEN` set                                   | ✅ Yes                        | Already done (see "Android release" below)                                                                                                                                                                                            |
| Android package identity               | `me.ottocode.mobile` / `me.ottocode.mobile.debug` (`packages/app/app.config.js`)                                           | ✅ Yes                        | Already done — fork-owned namespace, safe for eventual Play Store use                                                                                                                                                                 |
| Play Store listing (internal track)    | Play Console app `me.ottocode.mobile` live; `Android Play Release` auto-submits the AAB to the internal track on `v*` tags | ✅ Yes (internal)             | Already done — Play Console dev account, `GOOGLE_SERVICE_ACCOUNT_KEY` secret, Android Publisher API enabled, and service account granted release perms (all during 0.5.1). Production/open tracks + store-listing polish still manual |
| Push notifications (FCM)               | No Firebase project yet; `app.config.js` resolves `google-services` files from env/`.secrets`                              | ❌ No                         | Your own Firebase project + `google-services.json` for `me.ottocode.mobile`                                                                                                                                                           |
| **Daemon + web UI (the app itself)**   | Your own home server, once you enable `--web-ui`                                                                           | ✅ Ready, just needs enabling | Nothing new — built into the daemon. See "Local network hosting" below.                                                                                                                                                               |
| Web app (`app.otto-code.me`)           | Cloudflare Pages project `otto-app`, deployed by `Deploy App` on stable `v*` tags                                          | ✅ Yes                        | Already done — custom domain attached 2026-07-11 (see "Web app custom domain" below for the gotcha)                                                                                                                                   |
| Domain (`otto-code.me`)                | On the fork's Cloudflare account; Workers/Pages custom-domain routes bound                                                 | ✅ Yes                        | Already done                                                                                                                                                                                                                          |
| Marketing website (`packages/website`) | Cloudflare Workers on the fork's account, deployed by `Deploy Website`                                                     | ✅ Yes                        | Already done                                                                                                                                                                                                                          |
| QR-code pairing (relay-based)          | `relay.otto-code.me` deployed by `Deploy Relay` (Cloudflare Durable Objects)                                               | ✅ Deployed                   | Infra fully in place as of 2026-07-11 (relay + `app.otto-code.me` both live); verify a QR pair end-to-end from a phone once                                                                                                           |
| Direct connection (no relay, no QR)    | Works today, zero cloud dependency                                                                                         | ✅ Yes                        | Nothing — host/port/password against your own daemon, works over LAN or your domain once exposed                                                                                                                                      |
| macOS code signing                     | N/A (not configured)                                                                                                       | N/A                           | Apple Developer Program ($99/yr) + certs as GH secrets, only if you want signed/notarized Mac builds                                                                                                                                  |
| Windows code signing                   | N/A (ships unsigned)                                                                                                       | N/A                           | Optional; unsigned Windows builds just show a SmartScreen warning on first run                                                                                                                                                        |

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

- **macOS builds are skipped as-is.** `electron-builder.yml`'s `mac:` section has `notarize: true`
  unconditionally, and the workflow expects `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password), and `APPLE_TEAM_ID` as GitHub
  secrets — note the workflow reads `secrets.APPLE_PASSWORD`, not `APPLE_APP_SPECIFIC_PASSWORD`.
  `desktop-release.yml` gates `publish-macos` on `APPLE_CERTIFICATE` being present, so without an
  Apple Developer Program membership the macOS jobs skip cleanly and the release run stays green
  on Windows/Linux. Windows and Linux ship unsigned (Windows shows a SmartScreen warning on first
  run; that's normal for unsigned installers).
- **npm publish works (as of 2026-07-11).** The `otto-code` npm org is claimed (owner
  `draek2077`) and all six packages first published at 0.5.0, so the full `release:patch`
  chain — including `release:publish` — runs end to end. The only prerequisite is being
  logged in (`npm whoami`) as an org member on the machine running the release. If publish
  fails mid-chain the tag exists but is unpushed; resume with `npm run release:publish` then
  `npm run release:push` rather than re-running the chain.

## Android release

Android builds go through EAS (Expo Application Services), a hosted build service tied to an Expo
account — not your GitHub repo. **This is now fork-ready**: `packages/app/app.config.js` points at
the `otto-code` Expo org's own project, not upstream's.

```js
// packages/app/app.config.js
extra: { eas: { projectId: "69eddb63-f77d-413a-b2b7-ed83e8e16759" } },
owner: "otto-code",
```

### Setup (one-time)

1. ✅ Done — Expo account/org created (`otto-code`).
2. ✅ Done — `npx eas init` created a fresh EAS project under that org
   (`69eddb63-f77d-413a-b2b7-ed83e8e16759`).
3. ✅ Done — `owner` and `extra.eas.projectId` in `app.config.js` updated to match.
4. ✅ Done — Android `applicationId` repointed to the fork's own namespace:
   `me.ottocode.mobile` (production) and `me.ottocode.mobile.debug` (development), controlled by
   `APP_VARIANT` in `app.config.js`. Play Store package names are globally unique and permanent
   once published, so this had to diverge from upstream's `ai.ottocode` before any store
   submission.
5. ✅ Done — `EXPO_TOKEN` secret added to the GitHub repo (Settings → Secrets → Actions), generated
   from the `otto-code` Expo account, so `.github/workflows/android-apk-release.yml` can
   authenticate.
6. **Still open: push notifications (FCM).** Create your own Firebase project scoped to
   `me.ottocode.mobile` and supply `google-services.json` per `packages/app/app.config.js`'s
   `googleServicesFile` resolution (env var or `.secrets/google-services.prod.json`; iOS
   equivalents exist for the `GoogleService-Info` plist).

### Two distribution paths

You said "at least Android for now" — here are the two ways to get a build to a phone, in order
of how much infrastructure each needs:

**A. GitHub Release APK, no Play Store (least infra).** Push a `vX.Y.Z` or `android-vX.Y.Z` tag;
`.github/workflows/android-apk-release.yml` builds via EAS's `production-apk` profile (internal
distribution, not submitted anywhere) and attaches the APK to the GitHub Release. Users
sideload it directly. Still needs your own EAS project (step 1-3 above) and `EXPO_TOKEN`, but
skips the Play Console entirely — no $25 fee, no store review, no `eas submit` credentials.

**B. Play Store internal track (full infra — ✅ wired 2026-07-12).** The `Android Play Release`
workflow builds an AAB and auto-submits it to the Play **internal testing** track on a `v*` tag.
This is the path for getting a build to testers without hand-uploading. Full details, the two
one-time Google prerequisites, the build gotcha, and the retry mechanism are in "Play
internal-track auto-submit" just below. `eas.json` also keeps a `submit.production` profile for
an eventual production-track submit, but that track (and the store listing polish it needs) is
still manual.

There's also a **zero-infrastructure fallback** for a quick local test build: `npm run
android:production` from the repo root builds and installs a release APK directly to a connected
device/emulator with no EAS account at all (see [docs/android.md](android.md)). Good for smoke-testing
before you've set up EAS; not a distribution mechanism for other users.

### Play internal-track auto-submit

`.github/workflows/android-play-release.yml` is the automated replacement for hand-downloading the
AAB and uploading it in the Play Console. On a `v*` tag it builds an AAB via EAS's `production`
profile and runs `eas submit --profile internal` (see `eas.json`'s `submit.internal`, which reads
`packages/app/google-service-account.json`). It's kept separate from `android-apk-release.yml` so
the sideload APK and the Play submit retry independently.

**Repo secrets it needs** (both set): `EXPO_TOKEN` (authenticates EAS) and
`GOOGLE_SERVICE_ACCOUNT_KEY` (full JSON of a Play service-account key). The workflow materializes
the key to `packages/app/google-service-account.json` at submit time from the secret and deletes it
after — the file is gitignored and must never be committed.

**Two one-time Google setups — both are separate permission layers, and both were done during
0.5.1:**

1. **Google Cloud → enable the Android Publisher API** for the GCP project the service account
   belongs to. Without it, submit fails `PERMISSION_DENIED: Google Play Android Developer API has
not been used in project <id> before or it is disabled`. Enable it, wait a few minutes to
   propagate.
2. **Play Console → Users and permissions → invite the service-account email** (the `client_email`
   in the key JSON) with **Release to testing tracks** on `me.ottocode.mobile`. Enabling the API
   only lets the account authenticate; this grant lets it actually release. Without it, submit
   fails "the service account is missing the necessary permissions to submit the app."

**Build gotcha — hermesc OOM (fixed 2026-07-12).** The `production` (AAB) profile in `eas.json`
carries a `gradleCommand: ":app:bundleRelease --no-parallel --max-workers=1 -x lint ..."`. Without
that serialization, the AAB build dies at `:app:createBundleReleaseJsAndAssets` with `hermesc`
**exit code 137 (SIGKILL / OOM)** — Hermes compiles the JS bundle while the parallel native CMake
builds (reanimated, worklets, nitro) run concurrently and starve it of RAM. The `production-apk`
profile has always had these flags (that's why the APK build survived); the AAB profile didn't
until this fix. `production-apk` overrides `gradleCommand`, so it's unaffected.

**Retrying a failed _submit_ without rebuilding.** The workflow accepts a `workflow_dispatch`
`build_id` input: when set, the build step is skipped and that already-finished EAS build is
submitted as-is (~2 min instead of a ~7-min rebuild, and no wasted versionCode). Use it after
fixing a Google-side issue like the two setups above:

```bash
gh workflow run android-play-release.yml --ref main \
  -f tag=<tag with the current eas.json> -f build_id=<finished EAS build id>
```

Get the build id from the failed run's "Build ... on EAS" step log (`.../builds/<uuid>`). There's
also an `android-play-vX.Y.Z` tag trigger that rebuilds+submits only this path (independent of the
full `vX.Y.Z` release). Note the `eas submit` guard: it refuses a versionCode Play already has
("You've already submitted this version"), so if you upload a build to Play by hand first, the
automated submit of that same build will bounce as a duplicate — a fresh release (new versionCode)
avoids it.

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

**Status (2026-07-08, completed 2026-07-11): option 2 below is what happened.** The relay is
deployed to the fork's Cloudflare account at `relay.otto-code.me` by the `Deploy Relay`
workflow (runs on pushes to `main` touching `packages/relay/**`), and the web app that pairing
offers land on is deployed by `Deploy App` (stable `v*` tags) to the Cloudflare Pages project
`otto-app`, reachable at `app.otto-code.me` since the 2026-07-11 custom-domain attach (see
"Web app custom domain" below). All infrastructure is in place — the one remaining step is a
single end-to-end QR pairing verification from a phone. The options below are kept for context:

1. **Skip QR pairing, use Direct Connection.** Zero infrastructure, works today (see above), no
   cloud dependency.
2. **Deploy just the relay to Cloudflare's free tier** — ✅ done, see status note above. Durable
   Objects with the SQLite storage backend are available on Cloudflare's free plan, so this is a
   $0 coordination layer, not a hosting commitment. The daemon-side env vars
   (`packages/server/src/server/config.ts`) if you ever need to repoint it:
   - `OTTO_RELAY_ENDPOINT` / `OTTO_RELAY_PUBLIC_ENDPOINT` → `relay.otto-code.me:443`
   - `OTTO_RELAY_USE_TLS` / `OTTO_RELAY_PUBLIC_USE_TLS` → `true`
   - `OTTO_APP_BASE_URL` → wherever the pairing landing page is served (defaults line up with
     `app.otto-code.me`)
   - See [SECURITY.md](../SECURITY.md) for the relay's E2E encryption/threat model.
3. **Build a "Show as QR" feature for Direct Connection** (not yet implemented, but small). The
   `qrcode` npm package is already a dependency and already used for the relay-based pairing flow
   (`pair-device-section.tsx`). Encoding the same host/port/password URI
   (`serializeConnectionUriForStorage` in `packages/protocol/src/daemon-endpoints.ts`) into a QR
   code for the Direct Connection form would give you scan-to-connect on your LAN with zero relay
   dependency. This is a real, scoped feature addition — say the word if you want it built.

## Web app custom domain (✅ done 2026-07-11)

**Resolved 2026-07-11** — kept here because the gotcha will bite again on any future Pages
project: `wrangler pages deploy` publishes builds to a Pages project but **never binds custom
domains**, and unlike the website/relay Workers there is no `wrangler.toml` route to carry the
binding. So `Deploy App` ran green on every stable tag since v0.4.1 and the app was live at
`otto-app.pages.dev`, while `app.otto-code.me` returned NXDOMAIN for a month — every "Web App"
link on the marketing site (`webAppUrl` in `packages/website/src/downloads.tsx`) was dead and
QR pairing offers (`https://app.otto-code.me/#offer=...`) couldn't land.

The fix was a one-time attach: Cloudflare dashboard → Workers & Pages → `otto-app` →
**Custom domains** → `app.otto-code.me`. **Second gotcha:** the "Cloudflare adds the CNAME for
you" step of that flow can silently not happen, leaving the domain stuck in "Verifying" with no
DNS record — if so, manually add the record in the `otto-code.me` zone (DNS → Records: CNAME
`app` → `otto-app.pages.dev`, proxied) and the domain validates within minutes. Verified
2026-07-11: DNS resolves, HTTPS 200, app and manifest served.

## Marketing website

**✅ Deployed (2026-07-08 status).** `packages/website` — the `otto-code.me` landing page, docs,
download links, changelog — runs on Cloudflare Workers on the fork's account
(`packages/website/wrangler.toml` carries the fork's `account_id` and the
`otto-code.me`/`www.otto-code.me` custom-domain routes). The `Deploy Website` workflow redeploys
it on pushes to `main` touching `CHANGELOG.md`/`public-docs/**`/`packages/website/**` and on
published (non-prerelease) GitHub releases, using the `CLOUDFLARE_API_TOKEN` repo secret.

It remains tightly coupled to Cloudflare Workers (`@cloudflare/vite-plugin`, a KV namespace for
caching, a Workers `fetch` handler in `packages/website/src/server-entry.ts`); porting it to a
plain Node process on your own hardware would be a real side-project (swap the Cloudflare adapter
for TanStack Start's Node preset, replace the KV cache), not a config change — only relevant if
full infrastructure independence ever becomes a goal.

## Domain

`otto-code.me` is live on the fork's Cloudflare account; the Workers custom-domain routes
(`otto-code.me`, `www.otto-code.me`, `relay.otto-code.me`) are bound there, and
`app.otto-code.me` is bound to the `otto-app` Pages project (attached 2026-07-11 — see
"Web app custom domain" above).
Everything that referenced `otto-code.ai` across source, docs, nix packaging, and the
upstream-merge rebrand tooling (`scripts/rebrand-upstream.pl`, `docs/upstream-merges.md`) has been
swapped — future `git merge upstream/main` runs will rebrand new Paseo code straight to
`otto-code.me` / `Draek2077/otto-code` without drifting back.

## Full release checklist

Pulling the above into one end-to-end runbook for "ship a new version":

- [ ] Working tree clean, on `main`, format/lint/typecheck all green
- [ ] Decide patch vs. beta (see "Versioning" above)
- [ ] Confirm you're logged into npm as an `otto-code` org member (`npm whoami`)
- [ ] `npm run release:patch` (or the beta mode) — bumps, commits, tags, publishes the six
      `@otto-code/*` packages to npm, and pushes HEAD + tag (triggers CI workflows). If the
      publish step fails, the tag exists but is unpushed — resume with `npm run release:publish`
      then `npm run release:push`
- [ ] **npm**: spot-check `npm view @otto-code/cli version` reports the new version
- [ ] **Desktop**: confirm `Desktop Release` workflow is green for Windows/Linux on the new tag
      (macOS jobs skip until Apple signing is set up), and `finalize-rollout` uploaded the
      updater manifests
- [ ] **Android (APK)**: confirm `Android APK Release` workflow is green and the APK is attached to
      the GitHub Release
- [ ] **Android (Play internal)**: confirm `Android Play Release` is green and the build reached the
      Play Console internal track. If only the _submit_ step failed on a Google-side issue, fix it
      and re-dispatch with the existing `build_id` (no rebuild) — see "Play internal-track
      auto-submit"
- [ ] **Web app**: confirm `Deploy App` ran on the tag (stable only)
- [ ] **Website**: confirm `Deploy Website` ran on the published release
- [ ] **Docker**: confirm the `Docker` workflow published `ghcr.io/draek2077/otto:X.Y.Z` (works
      automatically, no setup needed)
- [ ] Spot-check the changelog entry rendered correctly on the GitHub Release body

## What's genuinely not decided yet

Being explicit about the open questions rather than picking answers for you:

- **How far to take Play Store distribution.** The **internal testing** track is wired and working
  (auto-submit on `v*` tags — see "Play internal-track auto-submit"), which covers getting builds
  to invited testers. Going wider — the **production** track, or open/closed testing — still needs
  a completed store listing (screenshots, privacy policy, content rating) and is manual for now.
  GitHub-Release APK sideloading remains the zero-Play-infra alternative.
- **macOS code signing** — needs an Apple Developer Program membership; without it, scope releases
  to Windows/Linux (and Android) until/unless you decide it's worth $99/year.
- **iOS distribution** — untouched: no Apple account, and `eas.json` no longer carries upstream's
  App Store Connect app ID. TestFlight/App Store would need the Apple Developer account plus a
  fresh ASC app for `me.ottocode.mobile`.
