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

| Surface                       | Currently points at                                      | Fork-ready?               | What you need                                                                                                                       |
| ----------------------------- | -------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GitHub repo                   | `Draek2077/otto-code` (`origin`)                         | ✅ Yes                    | Already done                                                                                                                        |
| Desktop auto-update feed      | `Draek2077/otto-code` GitHub Releases                    | ✅ Yes                    | Already done (see below)                                                                                                            |
| npm packages (`@otto-code/*`) | Unregistered scope (nobody owns it)                      | ⚠️ N/A                    | Not needed unless you want `npm install @otto-code/cli` to work from your fork; skip `release:publish` until/unless you set this up |
| Docker image (GHCR)           | `ghcr.io/${github.repository_owner}/otto` (dynamic)      | ✅ Yes                    | Nothing — the workflow reads the owner from GitHub automatically                                                                    |
| Android build (EAS)           | Expo org `otto-code-ai`, hardcoded `projectId`           | ❌ No                     | Your own Expo account + your own EAS project (see "Android release" below)                                                          |
| Android package identity      | `ai.ottocode` / `ai.ottocode.debug`                      | ❌ No                     | A new `applicationId` — you can't reuse upstream's if it's already live on the Play Store                                           |
| Play Store listing            | N/A (not created)                                        | ❌ No                     | Your own Google Play Console developer account ($25 one-time)                                                                       |
| Push notifications (FCM)      | Firebase project tied to `ai.ottocode`                   | ❌ No                     | Your own Firebase project + `google-services.json`, once you have your own package ID                                               |
| Website hosting               | Cloudflare Workers, account `10ed39a1db...` (upstream's) | ❌ No                     | Your own Cloudflare account + `CLOUDFLARE_API_TOKEN` secret in your repo                                                            |
| Domain                        | `otto-code.ai` (upstream's)                              | ❌ No                     | Your own domain (in progress per your last message) — see "Domain" below                                                            |
| Relay (mobile pairing)        | `relay.otto-code.ai` (upstream's, used by default)       | ⚠️ Working, but not yours | Decide: keep riding on upstream's relay, or self-host your own (see "Pairing" below)                                                |
| macOS code signing            | N/A (not configured)                                     | N/A                       | Apple Developer Program ($99/yr) + certs as GH secrets, only if you want signed/notarized Mac builds                                |
| Windows code signing          | N/A (ships unsigned)                                     | N/A                       | Optional; unsigned Windows builds just show a SmartScreen warning on first run                                                      |

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

## Website

The marketing site (`packages/website`) deploys to Cloudflare Workers, and it's currently wired
to upstream's Cloudflare account:

```toml
# packages/website/wrangler.toml
account_id = "10ed39a1dbf316e30abd0c409bed40d6"  # upstream's account
routes = [
  { pattern = "otto-code.ai", custom_domain = true },
  { pattern = "www.otto-code.ai", custom_domain = true },
]
```

`.github/workflows/deploy-website.yml` deploys automatically on pushes to `main` that touch
`CHANGELOG.md`, `public-docs/**`, or `packages/website/**`, and on every published (non-prerelease)
GitHub Release — using a `CLOUDFLARE_API_TOKEN` secret that doesn't exist in your repo yet.

### Setup (once you have a domain)

1. Create your own Cloudflare account (free tier is fine for Workers + Pages-style routing).
2. Add your domain to Cloudflare and point its nameservers there.
3. Update `packages/website/wrangler.toml`: `account_id` → your account ID, `routes` → your
   domain(s).
4. Generate a Cloudflare API token scoped to Workers deploy + add it as `CLOUDFLARE_API_TOKEN` in
   your GitHub repo secrets.
5. Push — `deploy-website.yml` will deploy to your account/domain from then on.

The relay (below) uses the identical pattern in `packages/relay/wrangler.toml`, same upstream
`account_id`, same idea for repointing it.

## Pairing (QR code and direct paste)

What you described as "register via QR code as well as direct" is Otto's existing **device
pairing** flow — connecting the mobile app to a running daemon — not a user-accounts system.
There's no sign-up/login; a daemon generates a one-time pairing offer, and a phone consumes it
either by scanning a QR code or by pasting the same link manually
(`packages/app/src/components/add-host-method-modal.tsx` offers exactly these two options: "Scan
QR" and "Paste Link" — both consume the identical underlying URL, just via a different input
method).

Under the hood (`packages/server/src/server/pairing-offer.ts`):

- The daemon builds a "connection offer" containing its public key and the relay endpoint to
  reach it through, base64url-encodes it into a URL fragment, and either renders it as a QR code
  or hands you the raw link to copy.
- That URL defaults to `https://app.otto-code.ai/#offer=...` — **upstream's hosted web
  entry-point**, currently used because `appBaseUrl` defaults to `https://app.otto-code.ai` when
  nothing else is configured.
- The relay itself defaults to `relay.otto-code.ai:443` — also upstream's, currently used because
  `relayEndpoint` defaults there when unset.

**This already works for your fork as-is** — pairing rides on upstream's relay and app-base URL
by default, and nothing about it is broken. The open question is whether you want your fork's
pairing identity to be fully independent (your own relay, your own domain in the pairing link) or
whether continuing to use upstream's relay infrastructure for this one piece is acceptable to you.
That's a product/licensing call, not a technical one — flagging it rather than deciding it for you.

If you do want your own relay:

1. Deploy `packages/relay` (Cloudflare Worker, same pattern as the website) under your own
   Cloudflare account, with `packages/relay/wrangler.toml`'s `account_id` and `routes` updated to
   your domain (e.g. `relay.yourdomain.com`).
2. Point the daemon at it via env vars (no code changes needed —
   `packages/server/src/server/config.ts` already reads these):
   - `OTTO_RELAY_ENDPOINT` / `OTTO_RELAY_PUBLIC_ENDPOINT` → your relay's host:port
   - `OTTO_RELAY_USE_TLS` / `OTTO_RELAY_PUBLIC_USE_TLS` → `true`
   - `OTTO_APP_BASE_URL` → wherever your web app is hosted (e.g. `https://app.yourdomain.com`),
     so pairing links point at your own front door instead of `app.otto-code.ai`.
3. See [SECURITY.md](../SECURITY.md) for the relay's E2E encryption/threat model before doing this.

## Domain

You mentioned still deciding on `otto-code.ai` vs. "whatever cheap domain" — here's everything
that changes once you pick one, so it's a single pass instead of finding these one at a time:

- `packages/website/wrangler.toml` — `routes` (the marketing site's custom domain).
- `packages/relay/wrangler.toml` — `routes`, only if you self-host the relay (see above).
- `packages/server/src/server/config.ts` — `DEFAULT_APP_BASE_URL` / `DEFAULT_RELAY_ENDPOINT`
  constants, only if you self-host and want the _default_ (not just env-override) to point at
  your domain.
- `package.json` — root `homepage` field (currently `https://otto-code.ai`).
- `README.md` — any marketing links.
- Anywhere `docs/` or `public-docs/` link to `https://otto-code.ai` for the hosted web app or
  download page.

None of these need to change until the domain is actually live — pointing them at a domain you
don't control yet would just produce broken links.

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
