# Releasing Otto on the Paseo base

Otto keeps its existing GitHub release pipeline, app IDs, store identities, signing
secrets, and artifact names. Source workspaces remain `@getpaseo/*`. Published npm
packages are `@otto-code/*`; the packing script renames manifests and compiled
imports while preserving the SDK identifiers Paseo plugin authors use.

## Preparation and publication

The next product release is 0.10.0. Phase 0 produces verifiable builds; it does not
authorize publication. The selected Phase 1 features must return before that
release is approved.

For an approved release, use `.claude/skills/release/SKILL.md`. Prepare the
changelog and checks first. After approval, commit the changelog and run the
requested release command. That command checks CI, creates the version commit and
tag, and pushes them. It does not publish npm from the local machine.

The `npm Publish` workflow publishes seven packages using npm trusted publishing:
highlight, relay, protocol, client, plugin, server, and CLI. A failed publish is
retried at the same version; already-published packages are skipped. The Brain
package is absent from the clean base until that feature is rebuilt. CI checks the
renamed tarballs before release. `--pack-only` creates artifacts without publishing.

## Desktop artifacts

`Desktop Release` builds Windows x64 and arm64, Linux x64, and macOS arm64 and x64.
Unsigned macOS DMGs and ZIPs are always built independently of Apple signing. Their
names include `-unsigned`; signing discovery, hardened runtime, and notarization
are disabled for that job. Signed macOS output remains conditional on the existing
Apple credentials. Unsigned downloads do not supply an auto-update manifest.

Desktop release creation, platform uploads, and update-manifest finalization retain
their separate roles. Unsigned macOS build failures prevent finalization. Linux and
Windows update manifests keep the existing release channel and rollout handling.
Packaging smoke tests use the current Paseo harness with Otto's executable, CLI,
renderer origin, and lock filename.

To verify a branch without publishing, dispatch `Desktop Release` with an existing
version tag for metadata, the branch as `checkout_ref`, and `publish=false`.
Artifacts are retained by the workflow. Do not create a release tag for this check.

## Android artifacts and store submissions

`Android APK Release` builds the release APK directly on GitHub runners using
Expo prebuild and Gradle. It uses the existing keystore secrets, checks the
signature, rejects the Android debug certificate, and verifies package ID
`me.ottocode.mobile` and the version code from `native-release-version.js`.
The Hermes bundle pass remains separate from native assembly to bound memory use.
Feature-specific asset checks return with the features that own those assets.

The workflow accepts `checkout_ref` and `publish=false` for branch verification.
That mode skips GitHub release creation and retains the signed APK as a workflow
artifact. A normal release tag attaches the APK to its GitHub release.

Set `include_aab=true` to build an AAB in the same native pass and retain it as a
workflow artifact. The bundle's JAR signature must verify and its certificate must
match the verified release APK. This check uses no EAS build quota and performs no
Play submission.

Google Play AAB submission and iOS submission remain separate workflows with their
existing credentials and gates. Play's internal submission profile is preserved;
building a sideloadable APK does not depend on an EAS quota or a Play submission.

## Other distributions

The Docker build retains Paseo's current source-build architecture and installs
the same renamed npm tarballs as the release workflow. Its external contract stays
Otto: `ghcr.io/<owner>/otto`, `/home/otto`, `OTTO_*`, and port 6868. The Nix build
retains the current upstream build machinery with Otto commands and metadata.

Otto's website and public manual remain on Otto's deployment configuration. Relay
hosting is retired; no release workflow deploys an Otto relay. Clients use Paseo's
hosted relay through the unchanged upstream transport.
