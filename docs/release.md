# Release

All workspaces share one version and release together.

## Requested version and channel

Release exactly the version and channel the user requests through the normal
release pipeline. An explicit version takes precedence over default bump rules.
Create a beta only when the user requests one. When the user ends a beta and
requests the stable release, publish that stable version and continue forward.
Do not insert a beta into a stable release request.

A stable release publishes npm packages to `latest`. Moving the existing `beta`
pointer to that stable version is authorized release housekeeping, not creation
of a beta release. Handle it during the release with available automation and
credentials, without asking the user each time. Never turn tag maintenance into
a manual npm login/2FA task, an end-of-release TODO, or a stable-release blocker.
If it cannot be done automatically, leave it alone without recurring reminders.
Do not substitute alternative release paths. Retry failed publishing or builds at the same version through CI. If the
requested pipeline is blocked, report the specific blocker without substituting
another version, channel, or publishing method.

## Google sign-in build input

Desktop release builds read the repository Actions secret
`OTTO_GOOGLE_OAUTH_CLIENT_JSON`, containing the publisher's Google **Desktop app**
registration JSON. Configure it before publishing. All four desktop build paths
pass it to the server build and require it when publishing; a missing registration
fails the build instead of shipping disabled Google connectors.

npm packages are published by the `npm Publish` workflow, which reads the same
secret, so no release machine needs the registration. Only a manual fallback
publish or a local desktop build needs it: set `OTTO_GOOGLE_OAUTH_CLIENT_FILE` (or
`OTTO_GOOGLE_OAUTH_CLIENT_JSON`) and `OTTO_REQUIRE_GOOGLE_OAUTH_CLIENT=1` in that
shell, and keep them through `npm publish` because the server's `prepack` performs
a clean rebuild. Supply only one of the file and JSON inputs. Never commit the
registration or print its contents.

## npm publishing from CI

Pushing a `v*` tag runs `.github/workflows/npm-publish.yml`, which publishes the
eight `@otto-code/*` packages (highlight, relay, protocol, client, plugin, server,
brain, cli) with **npm trusted publishing**: GitHub's OIDC identity replaces npm
tokens, so no one logs in and no 2FA prompt appears. npm attaches provenance
automatically. Stable versions publish to `latest`, prereleases to `beta`.

- `scripts/publish-release-packages.mjs` publishes in dependency order and skips
  any package already on the registry at that version, so a failed run is fixed by
  rerunning it: **Actions → npm Publish → Run workflow** with the tag.
- Each package's `repository.url` must stay
  `git+https://github.com/Draek2077/otto-code.git`; npm rejects a trusted publish
  whose repository does not match.
- Each package's trusted publisher on npmjs.com names the workflow file
  `npm-publish.yml`. **Renaming the file breaks publishing** until every package is
  reconfigured.

**One-time setup, per package** (repeat for all eight). Either in the package's
settings on npmjs.com under Trusted Publisher (GitHub Actions, owner
`Draek2077`, repository `otto-code`, workflow `npm-publish.yml`), or from a
terminal with npm 11.15 or newer and account 2FA:

```bash
for package in highlight relay protocol client plugin server brain cli; do
  npx npm@latest trust github "@otto-code/$package" --file npm-publish.yml --repo Draek2077/otto-code --allow-publish
done
```

Once a CI publish has succeeded, set each package's publishing access to
"Require two-factor authentication and disallow tokens" so only the workflow and
an interactive 2FA session can publish.

`npm run release:publish` is a user-only terminal command, used only when the user
explicitly requests manual publication. It is not a fallback agents select during
a normal release. It needs an `npm login` with 2FA and the Google registration input above.
See [connectors.md](connectors.md#daemon-ownership-and-publisher-configuration).

The server's `prepublishOnly` hook requires the Google registration input even
when the publisher forgets the opt-in environment flag. Slack and Dropbox's
public registrations compile into `connector-oauth-registration.js`; they need
no separate secret file. Desktop `afterPack` compares the OAuth broker, public
registrations, Google authorization module and configured Google JSON against
the files inside `app.asar`. Missing, empty or stale copies fail packaging before
signing or publishing. Unconfigured development builds may omit Google's JSON;
publishing desktop builds require it.

## Two steps

A release has exactly two steps. The agent does the first, the user authorizes the second.

**Preparation** (local, reversible - agent does this):

- format, lint, typecheck all green
- ACP provider catalog drift checked with `npm run acp:version-drift:check`;
  if stale package-runner pins are intentional, say so explicitly, otherwise run
  `npm run acp:version-drift:update` and commit the updated catalog
- resolve the release source to one commit and confirm that commit's existing CI is green
- classify the diff from the previous stable to the release source as patch or minor, then show the
  target version and rationale to the user
- draft the changelog, show it to the user, wait for review
- run the pre-release sanity check, surface findings to the user

**Go-ahead** (user says "go ahead"):

- commit the approved release inputs locally
- run the release, which pushes the prepared branch and tag; the tag push publishes npm from CI
- create the release heartbeat immediately and babysit it to completion

Rules that apply to both steps:

- Last-minute changes always need approval. Every time.
- No code changes bundled into the changelog commit or the release commit. Code shims live in their own commit, reviewed on their own merits.
- A sanity-check finding is information, not a directive. The agent surfaces it; the user decides.
- Invoking a release skill is intent to start the flow, not blanket authorization to publish.
- If the user asks for a release preview, show the prospective changelog/release contents and answer questions, but do not commit, tag, publish, or run release commands until they explicitly authorize the release.

## Release source and CI

The default release source is `origin/main`. Fetch `origin`, then record the
resolved commit. The default release checkout is a clean local `main` whose
`HEAD` equals `origin/main`.

An explicit user instruction can select another ref, such as a hotfix commit or
tag. Resolve that ref once and apply every source, diff, and CI check to that
commit instead of `origin/main`.

Before making release-preparation commits, confirm the existing CI run for the
resolved commit is green. Pending CI is watched to completion. Release
preparation then stays local through the changelog, any explicitly requested ACP
catalog update, lockfile preparation, and the version commit. After approval,
commit the prepared inputs locally and run the release command. Its branch and
tag push is the one remote release batch and starts CI for the complete release
commit.

## Release branch discipline

While you finalize a release on `main`, use a temporary `next` branch for work intended for the following
release. This applies to both beta and stable releases.

- Create each new `next` from freshly fetched `origin/main`. Reuse it while active.
- "This goes to next" means create the PR against `next` or retarget an existing
  PR, and keep that destination through delivery.
- Keep `next` current by merging `origin/main` into it as release fixes land.
  Avoid rebasing this shared branch because agents and open PRs depend on its history.
- After the release ships, bring `next` up to date and open a `next` → `main` PR.
  Pass CI and merge without squashing away the individual PR commits needed for
  the changelog. Retarget remaining PRs based on `next` to `main` and delete the integrated
  `next`. Create it fresh when needed again.

**Setup still needed:** CI, Docker, and Nix PR checks currently target only `main`,
and GitHub permits only squash merges. Enable checks and required-check protection
for `next`, CI on its pushes, and merge commits for the integration PR. Handle PR
base changes (`edited` events) so retargeting runs checks against the new base;
GitHub's default PR events do not cover this. Deployment triggers stay unchanged.

### Hotfix from a release tag

If `main` contains changes you do not want to release, branch from the affected
release tag and cherry-pick only the required fixes. Run CI on that branch, then
use the normal release flow with it as the explicit source, choosing a new patch
or beta version. Ensure the fixes and changelog also reach `main` and any active
`next`, preserving newer development and version changes there. This is a
short-lived hotfix branch, not another maintained release track.

## ACP catalog updates

ACP catalog work enters a release through an explicit user request:

- **Check ACP drift**: run `npm run acp:version-drift:check`. When drift exists,
  run `npm run acp:version-drift:update`, verify the catalog, and include the
  update in the local release-preparation commits. The check has three parts:
  exact npm/PyPI pins for package-runner entries; version labels for
  installed-command entries (`goose acp`) against the
  [ACP registry](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json),
  moved forward only; and registry coverage. A registry agent with no catalog
  entry fails the check until someone adds the entry or lists it in
  `REGISTRY_EXCLUSIONS` in `scripts/check-acp-catalog-version-drift.mjs` with a
  reason. `--update` never adds agents.
- **Update ACP**: run `npm run acp:version-drift:update`, verify the catalog, and
  include the update in the local release-preparation commits.

The release authorization covers the requested ACP commit. It ships in the same
release push as the changelog and version commit.

## Requested release channel

Use only the channel requested by the user:

1. **Direct stable release**: you are ready to ship the resolved release source to everyone immediately (default `origin/main`).
2. **Beta flow**: release candidates on the `beta` channel. Each beta refreshes the in-flight changelog entry in place, publishes npm only on the explicit `beta` dist-tag, and stays behind the Stable/Beta switch on `/download`.

The npm dist-tags are independent pointers:

- A beta release moves only `beta`; `latest` remains on the newest stable.
- A stable release moves `latest` and leaves `beta` where it is. A stale `beta`
  is harmless: the only reader is the Beta view on `/download`, which appears
  only while a newer beta leads stable, and that beta has already moved the
  pointer. Trusted publishing cannot move dist-tags anyway, so nobody moves it
  by hand and no release report mentions it.

## Release version decision

Every fresh release starts by classifying the full diff from the previous
stable to the resolved release source. The highest-impact change determines the
version:

- **Minor**: a user would experience the release as a significant upgrade. This
  includes substantial new workflows, providers, forges, platforms, integrations,
  or meaningful expansions of existing capabilities. Foundational internal work
  also qualifies when it materially changes reliability, performance,
  compatibility, deployment, or operation; diff size alone does not.
- **Patch**: fixes, polish, small enhancements, and reliability or performance
  improvements within existing capabilities. Follow-up corrections to a minor
  release are patches.

On this fork the classification never overrides the user. **Patch is the
default and the only thing a bare "release" request means** (see "Releases are
always patch" below); a minor bump requires the user to say "minor". Present the
classification and rationale with the changelog, then release what was approved.
Agents never select a major version autonomously.

Version bumps are never used to retry a failed build. Retry the existing version
as described in **Fixing a failed release build**.

## Standard release (patch)

Before running any stable patch release command:

- Make sure the resolved release source passed CI, the approved release inputs are committed locally on the intended branch, and the working tree is clean.
- **Run `npm run format`, `npm run lint`, and `npm run typecheck` and commit any resulting changes BEFORE you start any `release:*` command.** `release:check` runs `npm install --workspaces --include-workspace-root` as part of `release:prepare`, which can mutate `package-lock.json` (e.g. churning `"dev": true` markers on optional deps). The next step, `version:all:*`, runs `npm version` which aborts when the working tree is dirty. If this happens mid-flight you have to commit the lockfile churn before retrying, and the pre-commit format hook will reject a lockfile-only commit because oxfmt internally skips `package-lock.json` while lefthook's glob still matches it. Avoid the whole mess by running format/lint/typecheck first, then `release:prepare` once on its own to absorb any lockfile churn into a normal commit, then start the release.
- Do not use `npm run release:patch` as a substitute for checking whether the current commit is actually ready.

> **npm publishes from CI.** The release chain no longer publishes from the release machine,
> so it needs no npm login, no 2FA, and no Google registration. The tag push runs
> `npm Publish` (see "npm publishing from CI"). If that workflow fails, rerun it for the tag;
> already-published packages are skipped.

```bash
npm run release:patch
```

This bumps the version across all workspaces, runs checks, and pushes the branch + tag. The tag push triggers `npm Publish`, `Desktop Release`, `Android APK Release`, `Docker`, `Deploy App` (web app to Cloudflare Pages), and `Release Notes Sync` on GitHub Actions; `Deploy Website` redeploys when the GitHub release is published (stable only). See "Mobile builds (EAS)" below for what does - and on this fork does **not** - happen on the store side.

The Docker workflow builds images from the checked-out source tree on pull requests and on `main` as non-publishing checks. Stable `vX.Y.Z` tag pushes publish `ghcr.io/draek2077/otto:X.Y.Z` and `ghcr.io/draek2077/otto:latest`; beta `vX.Y.Z-beta.N` tag pushes publish only `ghcr.io/draek2077/otto:X.Y.Z-beta.N` and never move `latest`.

**Releases are always patch.** "Release otto", "release stable", "ship stable", and similar always mean a patch bump from the previous stable. Never bump minor or major to trigger a build, ever - minor and major bumps are reserved for genuinely larger product cuts and require an explicit user instruction with the word "minor" or "major". If you find yourself reaching for `release:minor` to retrigger a failed build, you are doing the wrong thing - push a retry tag instead (see "Fixing a failed release build" below).

Verify that `latest` resolves to the requested stable version for all eight
published packages. Handle any `beta` pointer alignment during the release using
available automation and credentials, without a separate user task or a trailing
TODO. Another channel's pointer does not block completion of the stable release.

The Docker workflow builds images from the checked-out source tree on pull requests and on `main` as non-publishing checks. Stable `vX.Y.Z` tag pushes publish `ghcr.io/Draek2077/otto-code:X.Y.Z` and `ghcr.io/Draek2077/otto-code:latest`; beta `vX.Y.Z-beta.N` tag pushes publish only `ghcr.io/Draek2077/otto-code:X.Y.Z-beta.N` and never move `latest`.

The production relay is the Elixir service in [Draek2077/otto-code-relay](https://github.com/Draek2077/otto-code-relay), with its own deployment process. Otto releases and pushes to this repository do not deploy it. The Cloudflare relay code and workflow in this repository are legacy and are not used in production.

**Stable means stable.** If the user says "stable" or "ship stable", do not ask whether they want a beta first. They picked stable; treat it as a direct stable release. Only run the beta flow when the user explicitly says "beta".

## Manual step-by-step

```bash
npm run typecheck            # Verify the exact commit you intend to release
npm run release:check        # Typecheck, build, dry-run pack
npm run version:all:patch    # Bump version, create commit + tag
npm run release:push         # Push HEAD + tag (triggers CI workflows, including npm Publish)
```

## Beta flow

```bash
npm run release:beta:patch       # Bump to X.Y.Z-beta.1, push commit + tag (CI publishes npm beta)
# ... test desktop and APK prerelease assets from GitHub Releases ...
npm run release:beta:next        # Optional: cut X.Y.Z-beta.2, beta.3, ...
npm run release:promote          # Promote X.Y.Z-beta.N to stable X.Y.Z
```

- Beta tags are published GitHub prereleases like `v0.1.41-beta.1`
- Betas publish npm packages with `--tag beta`, so `npm install @otto-code/cli@beta` opts in while plain `npm install @otto-code/cli` stays on `latest`
- Betas publish desktop assets and APKs for testing. They also build iOS, upload it to TestFlight, add it to the `Otto Beta` external group, and submit it for Beta App Review. They do not submit mobile builds to the production stores.
- `release:promote` creates a fresh stable tag like `v0.1.41`; the final release never reuses the beta tag
- Desktop assets now come from the Electron package at `packages/desktop`
- Beta releases use Electron's `beta` update channel. Users on the stable channel only receive stable releases; users on the beta channel receive beta releases and the final stable release when it is published.
- **Each beta refreshes the in-flight changelog entry in place.** `Release Notes Sync` mirrors the matching `## X.Y.Z-beta.N` entry into that prerelease body. Promotion refreshes that entry for the final stable version. See the Changelog policy section.

Use the beta path when you need to:

- smoke a build yourself before promoting it to everyone
- test a build manually in a Linux or Windows VM
- send a build to a user who is hitting a specific problem
- iterate on `beta.1`, `beta.2`, `beta.3`, and so on before deciding to ship broadly

## Staged rollout (stable channel)

Stable desktop releases go out via a linear time-based rollout for automatic update checks: 0% admitted when the updater manifests appear, 100% admitted 36 hours later, linear ramp in between. Manual checks bypass the rollout so a user can install immediately when they click **Check**. Beta releases bypass the rollout entirely - beta users always receive updates immediately.

The rollout is driven by a `rolloutHours` field stamped into the GitHub Release manifests (`latest-mac.yml`, `latest-linux.yml`, `latest.yml`) by the `finalize-rollout` job in `desktop-release.yml`.

> **Gotcha - a rollout deferral is not "no update", and an automatic check may never retract one.**
> electron-updater has a single signal for both: refusing admission in
> `isUserWithinRollout` emits `update-not-available`, exactly like being up to date.
> That matters because the client polls every `PENDING_RECHECK_MS` (10s) while an
> update is pending, and those polls use the **automatic** intent. So a user who
> clicked **Check** during a live rollout (manual, admitted) watched the offer
> disappear seconds later when the first automatic poll was deferred - mid-download,
> looking exactly like the check had never happened. Two rules keep the two apart:
>
> - `app-update-service.ts` records the version a check was deferred on
>   (`rolloutDeferredVersion`) and refuses to clear cached update state or report
>   "no update" for it. Version equality is tested before the rollout gate upstream,
>   so a genuinely up-to-date app never sets that flag and still clears normally.
> - `desktop-app-updater.ts` (client) lets only a user-initiated check take an
>   update away. A silent poll may add one, never remove one.
>
> The same class of bug on the install side: `installed: false` used to render as
> "You're up to date", so a download that failed after several minutes was
> indistinguishable from never having checked. Install results now carry an
> `outcome` (`installed` / `deferred` / `failed`) and the UI shows the reason.

Desktop release builds now publish in two phases:

- The GitHub Release stays a draft while platform build jobs upload the installers/packages (`.dmg`, `.zip`, `.exe`, `.AppImage`, etc.).
- The final job merges and stamps every channel manifest, uploads them with the final `releaseDate` and `rolloutHours`, then publishes the GitHub Release.

Drafts do not appear in GitHub's releases feed. Updater clients continue to see the previous complete release until all manifests for the configured publishing platforms are available. If a desktop build or manifest upload fails, the new release stays a draft.

### Default behavior

`npm run release:patch` → tag push → 36h ramp. No extra action needed.

The `rollout_hours` input on `desktop-release.yml` is **only read on `workflow_dispatch`** - tag-push runs always default to 36. To get any other rollout duration on a fresh release, use the post-publish flip below.

### Instant-admit release (rollout_hours=0 from publish)

For a fresh release that should admit everyone immediately (low-risk change, doc-only, hotfix, or just a release you want out fast), cut the release normally and queue the rollout flip immediately after:

```bash
# 1. Cut and publish (default 36h ramp from tag push).
npm run release:patch

# 2. Immediately queue the flip - runs as soon as finalize-rollout completes.
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.64 \
  -f rollout_hours=0
```

**Why this is gap-free:** `desktop-release.yml`'s `finalize-rollout` job and `desktop-rollout.yml` share the concurrency group `desktop-rollout-<tag>`. Dispatching `desktop-rollout.yml` while the tag-push pipeline is still running queues it safely behind `finalize-rollout`. The first public manifests already carry `rolloutHours=36`, then `desktop-rollout.yml` flips them to `rolloutHours=0` shortly afterward. The renderer polls every 30 minutes, so active stable users pick up the new manifest on their next check.

Run the dispatch right after `release:patch` returns. Don't wait for the tag-push CI to finish.

### Adjusting an already-published release

To change the rollout duration on a release that's already shipped - e.g. flip a hotfix to instant admit, or slow a release down - use the dedicated `desktop-rollout.yml` workflow. It edits the manifests in place on the GitHub release without rebuilding anything. It only rewrites `rolloutHours`; `releaseDate` is preserved, so the rollout clock keeps ticking from the original publish time.

**Hotfix (instant admit) on an already-shipped release:**

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.42 \
  -f rollout_hours=0
```

`rollout_hours=0` admits 100% of stable users on their next update check (within ~30 min for active clients).

**Slow a rollout down** (e.g. extend total duration to 72h since the original release):

```bash
gh workflow run desktop-rollout.yml \
  -f tag=v0.1.42 \
  -f rollout_hours=72
```

`rollout_hours` is **total duration since the original release date**, not "extend by N more hours from now." If `v0.1.42` was published 2h ago and you set `rollout_hours=72`, the ramp finishes 70h from now.

The dispatch is idempotent and shares the `desktop-rollout-<tag>` concurrency group with `desktop-release.yml`'s `finalize-rollout` job, so it serializes safely against an in-flight tag-push pipeline targeting the same release.

### Custom ramp on a manually-dispatched build

`desktop-release.yml` accepts `rollout_hours` only on `workflow_dispatch`, which is the path used to **rebuild an existing tag** (retry a failed release, force a rebuild on a different ref). When you go that route, you can stamp a non-default ramp directly:

```bash
gh workflow run desktop-release.yml \
  -f tag=v0.1.43 \
  -f rollout_hours=6
```

This does **not** apply to fresh releases cut via `npm run release:patch` - that path always tag-pushes and stamps 36. For a fresh release with a custom ramp, cut normally and then dispatch `desktop-rollout.yml` (same pattern as the instant-admit flow above, with your chosen `rollout_hours`).

### Releasing during an active rollout

If you ship N+1 while N is still ramping, N+1 starts a fresh rollout from its own publish timestamp. N's rollout effectively ends - the newer manifest supersedes it.

If N+1 is a hotfix for a bug in N, dispatch `desktop-rollout.yml -f tag=v0.1.<N+1> -f rollout_hours=0` after N+1 publishes so the users who already got N reach the fix fast.

### macOS system floor

The desktop app uses Electron 44 and requires macOS 13 or newer. Keep both release guards when the floor changes:

- `packages/desktop/electron-builder.yml` writes the macOS version to `LSMinimumSystemVersion` for new installs.
- `scripts/merge-mac-manifest.mjs` writes the matching Darwin kernel version to `minimumSystemVersion` in the update manifest. Existing clients check this before downloading an update.

macOS 13 maps to Darwin 22. The two values use different version domains; do not copy the macOS version into the update manifest.

### Limitations

- **No pause / kill switch.** Once a stable user is admitted, they will install the update on next quit (`autoInstallOnAppQuit = true`). To stop new admissions, ship a superseding release. To "recall" already-admitted users, ship a hotfix `+1` patch.
- **No rollback.** `allowDowngrade = false`. Bad release = ship a hotfix.
- **Bootstrap caveat.** Clients running a build older than the rollout feature ignore `rolloutHours` and admit immediately. Rollout protection only applies to clients running the rollout-aware version or later.
- **Up to ~30 min automatic admission latency.** Renderer polls every 30 minutes, so a stable user may take up to that long to be evaluated against the rollout window. Clicking **Check** is manual and bypasses rollout admission.

## Mobile builds (EAS)

> **Fork reality (Draek2077/otto-code, updated 2026-07-27):** this fork's mobile release paths
> live in this repo's own workflows, not upstream's EAS-GitHub-app-triggered flow. The paths that
> still call EAS draw on **one shared EAS free-plan budget of 15 Android builds a month** - see
> [fork-release-guide.md](fork-release-guide.md)'s infrastructure inventory for how that budget was
> exhausted on 2026-07-12. **The APK no longer spends it:**
>
> - **Android APK (GitHub Release asset)** - `.github/workflows/android-apk-release.yml`. Live and
>   active on `v*`, betas included. **Built on the GitHub runner** (`expo prebuild` + `gradle
assembleRelease`), not on EAS, so it is unlimited and no longer rations releases against the
>   monthly budget. Needs the four `ANDROID_KEYSTORE_*` secrets (the same keystore EAS uses, so the
>   APK stays a drop-in update over an EAS-built Otto); it no longer needs `EXPO_TOKEN`.
>   `versionCode` is derived from the version as `major*10000 + minor*100 + patch` (0.7.2 → 702)
>   rather than from EAS's remote counter, which drifted past 50 because quota-refused builds still
>   incremented it.
> - **Android (Play Store internal track)** - `.github/workflows/android-play-release.yml`. Wired
>   but **off `v*`** as of 2026-07-27: it has never completed a submit from CI, and leaving it on
>   every tag spent half the monthly Android budget. Trigger it with an `android-play-v*` tag or
>   `workflow_dispatch`. Needs `EXPO_TOKEN` + `GOOGLE_SERVICE_ACCOUNT_KEY`.
> - **iOS (TestFlight)** - `.github/workflows/ios-release.yml`. Wired but **gated off**: no Apple
>   Developer account or App Store Connect app exists yet, so the workflow's signing gate skips it
>   cleanly on every tag push. See [fork-release-guide.md](fork-release-guide.md)'s "iOS release"
>   section for the one-time Apple/ASC setup that turns it on.
>
> Everything below describing upstream's EAS-GitHub-app flow (`submit_ios_for_review`,
> `submit_android` to production, Fastlane review submission) is **upstream's flow**, kept as
> reference - this fork does not have that GitHub app installed and does not use Fastlane.

Upstream's iOS and Android store builds are not in `.github/workflows` - they're triggered by the EAS GitHub app the moment the `v*` tag is pushed, which this fork does not use:

- **Android (Play Store)** - EAS builds with profile `production` and auto-submits to the Play Store via `eas submit` (EAS-managed credentials, no Fastlane).
- **iOS (TestFlight + App Store)** - EAS builds with profile `production`, uploads to TestFlight, and a Fastlane lane submits the build for App Store review.

This fork instead drives all three mobile release paths from its own `.github/workflows/*.yml` files (listed above), triggered directly by `v*` tag pushes like every other release workflow in this repo.

### Watching mobile builds from the terminal

Use the EAS CLI from `packages/app/`:

```bash
cd packages/app

# Recent builds (newest first). Pipe to jq for status only.
npx eas build:list --limit 8 --non-interactive --json | jq '.[] | {platform, status, appVersion, gitCommitHash}'

# Recent EAS workflow runs. This is the source of truth for submit/review jobs.
npx eas workflow:runs --json | jq '.[] | {status, workflowName, trigger, gitCommitHash, startedAt, finishedAt}'

# Filter by platform.
npx eas build:list --platform ios --limit 5 --non-interactive --json
npx eas build:list --platform android --limit 5 --non-interactive --json

# Inspect a specific build.
npx eas build:view <build-id>

# Inspect the full release workflow, including submit_ios, submit_android,
# and submit_ios_for_review.
npx eas workflow:view <workflow-run-id> --json

# Read failed submit/review job logs.
npx eas workflow:logs <workflow-job-id> --all-steps --non-interactive

# Stream logs for a build.
npx eas build:view <build-id> --json | jq '.logFiles[]'
```

A build's `gitCommitHash` must match the release tag commit. `status` walks through `NEW` → `IN_QUEUE` → `IN_PROGRESS` → `FINISHED` (or `ERRORED`/`CANCELED`). The EAS workflow run's `gitCommitHash` and `trigger` must also match the release tag.

Once a build is `FINISHED`, EAS still has release-critical work to do: Android must submit to the Play Store, and iOS must upload to TestFlight **and** submit the build for App Store review. The release is not done until all platforms are on their way through the stores.

For the `Release Mobile` EAS workflow, these jobs must pass:

- `build_ios` - iOS binary built
- `submit_ios` - iOS binary uploaded to App Store Connect/TestFlight
- `submit_ios_for_review` - iOS build submitted for App Store review via Fastlane
- `build_android` - Android store binary built
- `submit_android` - Android binary submitted to the Play Store

Do not treat `build_ios: SUCCESS` or `submit_ios: SUCCESS` as a completed iOS release. `submit_ios_for_review: FAILURE` means the iOS release is blocked even if the build is visible in TestFlight.

To confirm the submission landed, inspect the EAS workflow with `npx eas workflow:view <workflow-run-id> --json`. App Store Connect (review state for the matching version/build) and the Play Console track are the final ground truth.

## Release completion and heartbeat

A release is **in progress** after npm publication and tag push. Report it as
**shipped** only after every applicable build, publication, asset, manifest, and
store submission passes the completion checklist.

> **Fork scope:** babysit GitHub Actions (`Desktop Release`, `Android APK Release`, `Docker`,
> `Deploy App`, `Release Notes Sync`) only - the APK now builds inside `Android APK Release`
> itself, so there is no separate EAS build to watch for it. The `Release Mobile`
> workflow and the store submit/review jobs below don't exist on this fork - don't wait for
> them. `publish-macos` is skipped when Apple signing is not configured; unsigned macOS artifacts
> remain separate. A failed requested desktop build keeps the release in draft. The finalizer
> requires Windows/Linux manifests and the macOS manifest when the signing gate is enabled.

The user rarely opens the Expo dashboard. A failed EAS build or submit/review job can sit silently until users complain about a stale version. After every stable release, set up a long-delay babysit that re-checks GitHub Actions, EAS builds, and the EAS `Release Mobile` workflow for the release tag. If any build is `ERRORED`/`CANCELED`, any workflow is `FAILURE`, or any required submit/review job fails, surface it immediately. If all builds are `FINISHED` and all required submit/review jobs are `SUCCESS`, confirm and stop.

Immediately after every beta, stable, or promotion tag push, create a heartbeat
that resumes the release in the current conversation. Create it automatically
with `create_heartbeat`. The heartbeat owns the release until it either reaches
the completion checklist or finds a failure that needs new user authority.

Each heartbeat checks the release tag commit, all GitHub Actions runs for the
release branch and tag, npm dist-tags, the GitHub Release body and assets,
desktop updater manifests, the published Docker image, and the applicable EAS
workflow. Inspect the GitHub Release itself and confirm that the macOS, Linux,
Windows, and Android APK assets are present along with the channel manifests
(`latest-mac.yml`, `latest-linux.yml`, and `latest.yml` for stable;
`beta-mac.yml`, `beta-linux.yml`, and `beta.yml` for beta).

For stable releases, also confirm every required mobile build, upload, store
submission, and review-submission job for the release commit. For betas, confirm
the beta EAS workflow completed its TestFlight distribution and Beta App Review
path. Delete the heartbeat only after every applicable checklist item passes,
then report the release as shipped.

Pattern:

```jsonc
// mcp__otto__create_heartbeat arguments
{
  "name": "vX.Y.Z release babysit heartbeat",
  "cron": "*/10 * * * *",
  "timezone": "UTC",
  "maxRuns": 120,
  "expiresIn": "24h",
  "prompt": "Resume the vX.Y.Z release babysit for commit <sha>. Check npm tags; every GitHub Actions run for the release branch and tag; the published GitHub Release body, expected desktop/APK assets, and channel manifests; the Docker image; and the applicable app/website deployment workflows. Completion requires every applicable fork checklist item. Store submissions are outside the configured distribution paths. Signed macOS manifests are required only when Apple signing is configured; unsigned artifacts remain separate. If work is pending, wait for the next heartbeat. If a failure can be retried safely for the same version, follow the failed-release procedure; otherwise report the blocker. When every applicable completion-checklist item passes, delete THIS heartbeat, report shipped, and stop.",
}
```

Tight cadence on purpose. The first run fires immediately, giving a near-real-time status check before the conversation closes. Subsequent runs at 15-minute intervals catch transitions quickly: a failed EAS build or failed App Store review submission at +20m should not wait until +50m to surface. Keep the prompt short - the heartbeat is a status probe, not a research task - and have it bail out as soon as every platform is actually on its store path so the remaining runs do not generate noise.

## Release notes on GitHub

The GitHub Release body is populated automatically by the `Release Notes Sync` workflow (`.github/workflows/release-notes-sync.yml`). It triggers on every `v*` tag push and on any push to `main` that touches `CHANGELOG.md`, then runs `scripts/sync-release-notes-from-changelog.mjs` to mirror the matching changelog entry into the release body. You don't need to write release notes on GitHub manually - keep `CHANGELOG.md` correct and the workflow will sync it. To force a re-sync, dispatch the workflow with the tag input.

## Website behavior

- The website download page defaults to GitHub's latest published **stable** release.
- A published beta prerelease is offered behind the Stable/Beta switch on `/download` (`?channel=beta`), never as the default. The switch only appears while the newest prerelease leads stable on its core version, so promoting `X.Y.Z-beta.N` to `X.Y.Z` retires the beta channel from the page until the next beta line opens.
- `app.otto-code.me` has no beta, so the Beta view drops the whole Web section rather than showing an inert "stable only" placeholder. This fork also has no Homebrew cask, no Play Store listing, and no App Store app, so `/download` carries no rows for them at all: macOS ships unsigned `.dmg` files with first-launch instructions, Android ships the APK from the GitHub release, and iOS has no build. When a surface gains a distribution path, add its row back in `packages/website/src/routes/download.tsx`.
- The default download target only moves when you publish the final stable release tag like `v0.1.41`.
- The public `/changelog` page renders `CHANGELOG.md` as-is, so the in-flight `-beta.N` entry shows there once it lands on `main`. That's intended: it's where beta users check what's coming. Only the **default download target** stays pinned to the latest stable; the download links read GitHub's releases API, not the changelog, so a `-beta.N` heading on top never affects them.
- The download page's "What's new" link deep-links the **minor group** anchor (`/changelog#release-0.3`), not the exact entry: promotion collapses the beta entries into one stable entry, so the minor group remains the durable target. A version with no entry in the bundled changelog (a tag whose changelog commit hasn't redeployed the site yet) links the plain `/changelog` instead of a dead anchor.
- The website itself is deployed by `Deploy Website` (Cloudflare Workers), which redeploys on `release: published` for non-prerelease releases and on pushes to `main` that touch `CHANGELOG.md` or `packages/website/**`.

## Fixing a failed release build

**NEVER bump the version to fix a build problem.** New versions are reserved for meaningful product changes (features, fixes, improvements). Build/CI failures are fixed on the current version.

**Do not rely on `workflow_dispatch` for tagged code fixes.** The `workflow_dispatch` trigger runs the workflow file from the default branch but checks out the code at the tag ref (`ref: ${{ inputs.tag }}`). That means fixes committed to `main` won't change the tagged source tree being built. `workflow_dispatch` only helps when the fix lives in the workflow file itself.

For Docker-only retries, **do not push or force-push a `v*` release tag**.
`v*` tag pushes rebuild desktop assets, the Android APK, Docker, release notes,
and EAS mobile release builds. Use the Docker workflow dispatch instead:

```bash
gh workflow run docker.yml \
  --ref main \
  -f otto_version=X.Y.Z-beta.N \
  -f publish=true
```

This replaces `ghcr.io/draek2077/otto:X.Y.Z-beta.N` in place without touching
desktop, APK, or EAS release builders. The Docker exception is safe because the
dispatch runs from `--ref main` and uses the explicit `otto_version`; it does
not check out or move the `v*` release tag.

To retry a failed non-Docker release workflow, push a retry tag on the commit
you want to build. Reusing the same tag name is expected: move it with
`git tag -f ...` and push it with `--force` so the workflow rebuilds the commit
you actually want.

A failed desktop build leaves the GitHub Release as a draft. `finalize-rollout`
uploads manifests from successful platforms before it fails. A later
single-platform retry reuses those manifests, stamps the complete set with one
release date, and publishes the draft. Use `desktop-vX.Y.Z` when more than one
platform failed. A `workflow_dispatch` rebuild with publishing enabled follows
the same path against the existing draft.

Prefer a tag push over `workflow_dispatch` when rebuilding desktop or APK
release assets. Prefer Docker workflow dispatch when rebuilding only the Docker
image.

The retry tag patterns below still work and remain the supported way to rebuild specific release targets:

```bash
# Desktop (all platforms)
git tag -f desktop-v0.1.28 HEAD && git push origin desktop-v0.1.28 --force

# Desktop (single platform)
git tag -f desktop-macos-v0.1.28 HEAD && git push origin desktop-macos-v0.1.28 --force
git tag -f desktop-linux-v0.1.28 HEAD && git push origin desktop-linux-v0.1.28 --force
git tag -f desktop-windows-v0.1.28 HEAD && git push origin desktop-windows-v0.1.28 --force

# Android APK
git tag -f android-v0.1.28 HEAD && git push origin android-v0.1.28 --force

# Beta
git tag -f v0.1.29-beta.2 HEAD && git push origin v0.1.29-beta.2 --force
```

This ensures the checkout ref matches the actual code on `main` with the fix included.

- `vX.Y.Z` or `vX.Y.Z-beta.N` rebuilds the full tagged release
- `desktop-vX.Y.Z` rebuilds desktop for all desktop platforms only
- `desktop-macos-vX.Y.Z`, `desktop-linux-vX.Y.Z`, and `desktop-windows-vX.Y.Z` rebuild only that desktop platform
- `android-vX.Y.Z` rebuilds the Android APK release only

If you decide to publish a release without working desktop builds, inspect its
assets first, then publish it manually:

```bash
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo getpaseo/paseo --tag vX.Y.Z)
gh release view "$RELEASE_LOOKUP" --json isDraft,isPrerelease,assets
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z --draft=false

# Keep a beta marked as a prerelease:
RELEASE_LOOKUP=$(node scripts/github-release.mjs --repo getpaseo/paseo --tag vX.Y.Z-beta.N)
gh release edit "$RELEASE_LOOKUP" --tag vX.Y.Z-beta.N --draft=false --prerelease
```

This bypasses the updater-manifest guarantee. Use it only when the release is
intentionally unavailable to desktop updater clients.

## Notes

- `version:all:*` bumps root + syncs workspace versions and `@otto-code/*` dependency versions
- The npm `version` lifecycle regenerates F-Droid changelog files from `CHANGELOG.md` for stable releases only (`npm run fdroid:changelogs`) and stages them, so the release tag carries them. Betas are a no-op. A stable run **aborts the release** if `CHANGELOG.md` has no entry for the version being cut — commit the changelog entry first. See [docs/android.md](android.md) for why these files are generated per ABI.
- `release:prepare` refreshes workspace `node_modules` links to prevent stale types
- `npm run dev:desktop` and `npm run build:desktop` target the Electron desktop package in `packages/desktop`
- If `npm Publish` partially fails, rerun it for the tag - the script skips already-published versions
- Prereleases always publish with `--tag beta`, so they never move `latest`
- The website uses GitHub's latest published release API for download links, so published beta prereleases do not replace the stable download target.

## Changelog format

Release notes depend on the changelog heading format. The heading **must** be strictly followed:

```
## X.Y.Z - YYYY-MM-DD
## X.Y.Z-beta.N - YYYY-MM-DD
```

No prefix (`v`), no extra text. `Release Notes Sync` matches the `## X.Y.Z` (or `## X.Y.Z-beta.N`) line for the pushed tag to extract the version. A malformed heading breaks the release-notes sync for that tag.

`CHANGELOG.md` on `main` is also what the app's **What's new** sheet fetches and renders, so the file is a shipped product surface, not just a release input. `##` starts a release and `###` starts a section; the app reads section titles from the document, so renaming or adding one needs no app change. Everything under a section is rendered as Markdown: prose, lists, links, inline code, fenced code, block quotes, tables, and images. Raw HTML does not render — the shared Markdown parser runs with `html: false`, so a `<video>`, `<iframe>` or `<embed>` tag reaches the reader as visible markup. Keep media out of the changelog, or link to it. A GitHub callout renders as a block quote with its `[!NOTE]` marker still in the text. A release entry is what a user reads on a phone the moment they are offered the update — write it for them.

## Changelog policy

- `CHANGELOG.md` includes every stable release plus the single in-flight entry for the current beta series.
- The first beta of a version inserts a top entry like `## 0.1.60-beta.1 - YYYY-MM-DD`.
- Each subsequent beta updates that same top entry in place - bump the heading (`0.1.60-beta.1` → `0.1.60-beta.2`) and fold in whatever else landed.
- Stable promotion updates that same entry in place one last time: heading to `0.1.60`, date to the promotion day.
- One entry per version line. The `-beta.N` heading is intermediary - overwrite it, never append. Don't leave stale `-beta.N` entries behind and don't create a duplicate entry per beta.
- It always covers the full diff from the previous stable tag, regardless of how many betas were cut in between.

## Changelog ownership

- **The agent running the release writes the changelog entry - beta or stable.** Do not hand the changelog to another model or agent. The release agent has the release context and owns the final wording.
- Draft the entry from the previous-stable-to-`HEAD` diff, review it against the changelog policy below, show it to the user, and wait for approval before committing it. Each beta refreshes the same entry; promotion refreshes it one last time from the full previous-stable-to-`HEAD` diff.

## Changelog voice

The changelog is shown on the Otto homepage. Write it for **end users**, not developers.

- **Frame everything from the user's perspective.** Describe what changed in the app, not what changed in the code. Users care that "workspaces load instantly" - not that a component no longer remounts.
- **Never mention component names, internal modules, or implementation details.** No `WorkingIndicator`, no `accumulatedUsage`, no `reconcileAndEmitWorkspaceUpdates`. Also no "virtualized lists", no "remount", no "memoization", no "debounced", no "fuzzy ranking", no "controlled input", no "uncontrolled input" - these are implementation words masquerading as user-facing copy.
- **Concrete WRONG → RIGHT examples** (real mistakes from past releases):

  | Wrong (implementation-facing)                                                       | Right (user-facing)                                         |
  | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
  | Switching layouts no longer remounts the active chat                                | Splitting a pane no longer loses your scroll position       |
  | Model, mode, and thinking pickers - searchable virtualized lists with fuzzy ranking | Mobile model selector is faster and more straightforward    |
  | Text inputs in mobile sheets no longer flicker while typing fast                    | Typing in mobile sheets no longer flickers                  |
  | Compact web sheets no longer crash when swiped to dismiss                           | Sheets on mobile web no longer crash when swiped to dismiss |
  | Reduced re-renders in the chat list                                                 | Chat list scrolls smoothly                                  |
  | Added debouncing to the search input                                                | Search results no longer lag behind typing                  |

  Test: would a non-developer reader recognise what changed when using the app? If they'd need an engineer to translate ("what's a remount?"), the bullet is still implementation-facing - rewrite it as the symptom the user experiences.

- **Collapse internal iterations.** If a feature was added and then fixed within the same release, just list the feature as working. Users never saw the broken version.
- **Only list changes relative to the previous stable release.** The diff is `v(previous)..HEAD`. If something was introduced and fixed between those two tags, it never shipped - don't mention the fix.
  - **Common trap:** when drafting from `git log`, every commit looks like a separate bullet - including the "fix X" commits that landed on top of a brand-new feature in the same release window. Before listing a Fixed entry, check whether the thing being fixed was itself added in this same release. If so, drop the fix and fold it into the feature bullet.
  - **Example:** if the release adds an in-app browser and also contains a commit "fix: browser pane keyboard handling no longer steals shortcuts", do **not** list the keyboard fix under Fixed. The browser is shipping for the first time, so users will only ever see the working version. The Added entry covers it.
- **Cut low-signal entries.** "Toolbar buttons have consistent sizing" is too granular. Combine small polish items or drop them.

## Changelog conciseness

Every bullet must be scannable at a glance. The changelog is not release documentation - it's a list.

- **One sentence per bullet, max.** If a bullet contains two sentences, the second one is doing work that belongs in product docs, not the changelog. Cut it.
- **No trailing periods.** Bullets are list items, not prose. Drop the period at the end of every bullet, including the period inside any bolded lead-in. `**Configurable terminal scrollback**` not `**Configurable terminal scrollback.**`.
- **One line per bullet.** If a bullet wraps to three lines in a narrow column, it's too long.
- **Split bullets that pack multiple distinct changes.** If a bullet uses "and", "plus", a comma list, or an em-dash to chain several independent improvements, break them into separate bullets - even when they share a theme or author. One bullet = one user-facing change.
- **Trim qualifying clauses.** Drop "with a hint shown when…", "matching the CLI's behaviour", "across common install shapes". If the detail doesn't change whether a user cares, cut it.
- **Lead with what the user can do, not the mechanism.** The reader cares about the capability, not how it works under the hood. Do not explain LAN vs WAN, TLS handshakes, IPC, the daemon-relay topology, or any internal concept the user has not asked about. "Self-hosted relays can use a different TLS setting for the public endpoint" - not "Self-hosted relays support a separate TLS setting for the public endpoint, so the daemon can reach the relay over the LAN while the phone reaches it over the public secure address." If a feature genuinely needs background to be understood, it belongs in product docs, with a one-line teaser in the changelog.
- **Lead with the outcome.** "Windows: agents launch reliably from npm `.cmd` shims…" is better than "Windows: agents launch reliably across common install shapes. Claude, Codex, and OpenCode now start correctly…".
- **Attribution follows the split.** When you split a dense bullet, move each PR/author to the bullet it belongs to. Never duplicate the same PR across multiple bullets.

## Changelog attribution

Every changelog bullet must credit contributors and link to the PR(s) that delivered the change. This is not one-PR-per-line - a single bullet describes a user-facing change and may reference multiple PRs.

Format: append `([#123](https://github.com/Draek2077/otto-code/pull/123) by [@user](https://github.com/user))` at the end of each bullet. For changes spanning multiple PRs or contributors:

```markdown
- Voice mode now works on tablets with proper microphone permissions. ([#210](https://github.com/Draek2077/otto-code/pull/210), [#215](https://github.com/Draek2077/otto-code/pull/215) by [@alice](https://github.com/alice), [@bob](https://github.com/bob))
```

Rules:

- **Always link the PR number** as `[#N](https://github.com/Draek2077/otto-code/pull/N)`.
- **Always link the contributor's GitHub profile** as `[@user](https://github.com/user)`.
- **One bullet = one user-facing change**, regardless of how many PRs went into it. Group related PRs on the same bullet.
- **De-duplicate contributors.** If the same person authored multiple PRs in one bullet, list them once.
- **Only credit external contributors.** Skip attribution for [@boudra](https://github.com/boudra). The changelog credits community contributions - core team work is the default.
- **Credit the commit author, not the PR opener.** A maintainer often opens a PR that lands work authored by someone else (cherry-pick, rebase of a contributor's branch, manual extraction from a stacked PR). The squash commit preserves the original commit's author, but `gh pr view N --json author` returns the PR opener - using that field will silently mis-credit the work to the maintainer (and then the "skip @boudra" rule drops the attribution entirely). Always resolve attribution from commit authors.

  Use this command to get the GitHub logins for each PR:

  ```bash
  gh pr view N --json commits --jq '[.commits[].authors[].login] | unique | .[]'
  ```

  This returns every distinct GitHub login that authored or co-authored a commit in the PR. Use those logins for attribution. Fall back to `gh pr view N --json author` only if the commits command returns nothing (which should not happen for merged PRs).

  When listing PR numbers, `git log --format='%H %s' v<previous>..<release-source-sha> | grep -E '\(#[0-9]+\)$'` pulls the PR number out of squash commit subjects.

## Changelog ordering

Entries within each section (Added, Improved, Fixed) are ordered by user impact:

1. **User-facing features and changes first** - things users will notice, want to try, or that change their workflow.
2. **Quality-of-life improvements** - polish, performance, smoother interactions.
3. **Internal/infra changes last** - only include if they have a tangible user benefit (e.g. "faster startup" is user-facing even if the fix was internal).

## Pre-release sanity check

Before cutting a **stable** release, the release agent reviews the diff as a last line of defence against shipping bugs. Skip this for betas - the beta itself is the smoke test, and gating each beta on a code review defeats the point of using betas as fast release candidates.

Review the diff between the latest release tag and the resolved release source. Focus on:

1. **Breaking changes** - especially in the WebSocket protocol, agent lifecycle, and any server↔client contract.
2. **Backward compatibility** - the important direction is old app clients talking to newly updated daemons. Users update desktop and daemon first, then keep running the old app for a while. Flag anything that breaks old clients against new daemons or requires both sides to update in lockstep.
3. **Regressions** - anything that looks like it could break existing functionality.

Use `git diff <latest-release-tag>..<release-source-sha>` as the review input. This is a deep sanity check, not a full code review. If anything looks risky, investigate before proceeding and surface the finding to the user.

## Changelog scope

One entry per version line, always scoped `previous stable tag → release source`:

- **First beta**: insert the entry.
- **Later beta**: refresh that same entry in place and bump its `-beta.N` heading.
- **Direct stable release**: insert the entry.
- **Stable promotion**: refresh that same entry in place one last time, heading to `X.Y.Z` and date to the promotion day.

The scope never narrows to the previous beta. A beta entry is an in-flight draft of the stable record, so every beta and the promotion describe the full jump from one stable version to the next.

## Completion checklist

### Beta release

- [ ] The resolved release source is the intended commit (default `origin/main`) and its existing CI is green
- [ ] Every PR in the release range has been opened, and its full description and every linked issue have been read before drafting the changelog
- [ ] Refresh the in-flight `CHANGELOG.md` entry for this beta (create it for the first beta) (heading `## X.Y.Z-beta.N - YYYY-MM-DD`), review it against the changelog policy, get approval, and commit it before cutting the release
- [ ] The diff from the previous stable to the resolved release source is classified as patch or minor, with the target version and rationale approved
- [ ] Release preparation stayed local until the approved release command pushed the complete branch and tag
- [ ] `npm run release:beta:patch`, `npm run release:beta:minor`, or `npm run release:beta:next` completes successfully
- [ ] Every GitHub Actions run for the complete release commit and tag is green
- [ ] npm shows the version under the `beta` dist-tag, not `latest`
- [ ] The GitHub prerelease was published only after the required beta manifests were uploaded, and it has the changelog body and every expected asset for the configured desktop platforms plus Android APK
- [ ] GitHub `Desktop Release` workflow for the `v*-beta.N` tag is green
- [ ] The GitHub prerelease contains `beta-linux.yml` and `beta.yml`, plus `beta-mac.yml` when Apple signing is configured
- [ ] GitHub `Android APK Release` workflow for the same tag is green and the APK is attached
- [ ] GitHub `Docker` workflow is green and the versioned beta image is published without moving `latest`
- [ ] GitHub `Release Notes Sync` mirrored the beta entry into the prerelease body

### Stable release (or promotion)

- [ ] Run the pre-release sanity check (see above) and address any findings
- [ ] Ensure the intended release commit is already committed and the git worktree is clean before running any `release:*` patch/promote command
- [ ] Ensure local `npm run typecheck` passes on that exact commit before running any `release:*` patch/promote command
- [ ] Update `CHANGELOG.md` with user-facing release notes (features, fixes - not refactors). When promoting from beta, overwrite the existing `## X.Y.Z-beta.N` heading in place (heading → `X.Y.Z`, date → promotion day) - do not add a new entry on top of the beta one
- [ ] Verify the changelog heading follows strict `## X.Y.Z - YYYY-MM-DD` format
- [ ] `release:patch`/`release:promote` completes successfully and the tag's `npm Publish` workflow is green
- [ ] npm shows the new version on `latest` (`npm view @otto-code/cli version`)
- [ ] All eight npm packages resolve to the requested stable version on `latest`; any supported `beta` pointer alignment is handled during the release without manual user action or a trailing TODO
- [ ] The GitHub Release was published only after the required stable manifests were uploaded, and it has the changelog body and every expected asset for the configured desktop platforms plus Android APK
- [ ] GitHub `Desktop Release` workflow for the `v*` tag is green
- [ ] The GitHub Release contains `latest-linux.yml` and `latest.yml`, plus `latest-mac.yml` when Apple signing is configured
- [ ] Any published `latest-mac.yml` contains the current `minimumSystemVersion` guard
- [ ] GitHub `Android APK Release` workflow for the same tag is green and the APK is attached
- [ ] GitHub `Docker` workflow is green and both the versioned and `latest` images are published
- [ ] GitHub `Release Notes Sync` is green and the release body matches the stable changelog entry
- [ ] `Deploy App` and `Deploy Website` complete for the applicable release triggers
- [ ] Store submissions are not required until this fork configures those distribution paths
