# Audit: the 20 files upstream deleted that Otto still uses

**Date:** 2026-07-31 · **Merge:** `merge/paseo-v0.2.5` · **Status:** audit only, nothing ported yet

Upstream `v0.2.5` deletes 20 files Otto still depends on (git reports them `UD`: modified by us,
deleted by them). The agreed policy is **port onto upstream's replacement, and carry every Otto
change across rather than losing it**. This document is the per-file record of what we changed and
where it lands. It exists so that a missed change is caught here, not six months from now.

Every deleted file has an identified successor. Two of them are architectural rewrites where our
work does not map one-to-one, and those are the ones that need a decision.

## Summary

| Otto churn              | Files | Risk                             |
| ----------------------- | ----- | -------------------------------- |
| Heavy (66+ lines added) | 7     | Real Otto functionality to carry |
| Light (under 35 lines)  | 13    | Mostly rebrand and small edits   |

## Replacement map

| Our deleted file                                                    | Upstream replacement                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `components/file-pane.tsx`                                          | `file-pane/pane.tsx`, `bar.tsx`, `live-file.ts`, `conflict-alert.tsx`, `editor/`                       |
| `components/command-center.tsx`                                     | `command-center/command-center.tsx`, `contributions.ts`, `provider.tsx`                                |
| `hooks/use-command-center.ts`                                       | `command-center/provider.tsx`                                                                          |
| `stores/workspace-tabs-store/{index,state,state.test}.ts`           | `workspace-tabs/model.ts`, `identity.ts`                                                               |
| `components/use-web-scrollbar.tsx`                                  | `styles/web-scrollbar.ts` + `install-web-scrollbar-styles{,.web}.ts`                                   |
| `components/web-desktop-scrollbar.tsx`                              | same as above (component replaced by a CSS install)                                                    |
| `utils/desktop-window.ts`                                           | `utils/desktop-window.tsx`                                                                             |
| `workspace/editor-targets.ts`, `desktop/features/editor-targets.ts` | `desktop/features/editor-targets/{registry,runtime,ipc}.ts`, `components/icons/editor-target-icon.tsx` |
| `git/github-url.ts`                                                 | `utils/github-refs.ts` (`parseGithubUrl` moved)                                                        |
| `git/use-github-search-query.ts`                                    | `git/forges/github.ts` (upstream's forge layer)                                                        |

## The seven heavy files

### 1. `components/file-pane.tsx` (+730 / −142) — the largest, and it is Preview

Otto's additions are the **Preview subsystem's integration into the file viewer**, plus viewer
features upstream does not have:

- **Preview integration** (24 references): `PreviewScrollMetrics`, `PreviewLineMatchRange`,
  `PreviewFindQuery`, `PreviewPointerDown`, `readPreviewFileFacts`, `usePreviewFindHighlights`
- **Find-in-file**: `findMatches`, `matchRangesByLine`, `activeMatchLine`, `keyedSegments`
- **Synchronized scrolling**: `handleSyncScroll`, `handleSyncLayout`, `handleSyncContentSize`,
  `handleSyncPointerDown`, `syncMetricsRef`, `suppressNextScrollSyncRef`, `scrollToSyncTop`
- **Binary and image preview**: `BinaryPreview`, `imageDimensions`, `workspaceImages`
- **Web scrollbar wiring**: `showWebScrollbar`, `horizontalScrollbar`, `horizontalScrollRef`
- **File info reporting**: `useReportedFileInfo`, `onFileInfoRef`, `onFindMatchCountRef`

**Lands in:** upstream's `file-pane/pane.tsx` as the shell, with our viewer mounted at the seam where
their `editor/view` plugs in (per the agreed editor decision). Preview integration attaches at the
same seam rather than being inlined into their pane.

**Watch:** `docs/preview.md` is non-negotiable design here. Do not let the port quietly drop the
find-highlight or scroll-sync paths; they are what make browser-verified previews usable.

### 2. `stores/workspace-tabs-store/state.ts` (+243 / −18) — our extra tab kinds

Otto added target coercion for panel types upstream does not have:

`coerceCodeReferencesTabTarget`, `coerceCodeRenameTabTarget`, `coerceFileHistoryTabTarget`,
`coerceRefineTabTarget`, `coerceFileLikeTabTarget`, `coerceOptionalPairTabTarget`,
`coerceWorkspaceFileOrigin`, plus `SIMPLE_STRING_FIELD_BY_KIND` and `OPTIONAL_PAIR_FIELD_BY_KIND`.
Otto concepts referenced: orchestration (5), visualizer (4), Refine (3), personality (2),
orchestration graph (2), artifact id (2).

**Lands in:** upstream's `workspace-tabs/model.ts`. This is registration-shaped, so it is the best
seam candidate in the whole audit: our tab kinds should live in an Otto-owned contributions module
that upstream's model consults, not be interleaved into their coercion switch.

`state.test.ts` (+102 / 0) is the test for this and ports with it.

### 3 and 4. `use-web-scrollbar.tsx` (+74 / −8) and `web-desktop-scrollbar.tsx` (+139 / −70) — DECISION NEEDED

**Upstream deleted the concept, not just the file.** `useWebScrollbar` and `WebDesktopScrollbar` do
not exist anywhere in `v0.2.5`. Upstream replaced a React-rendered scrollbar with a CSS install
(`styles/web-scrollbar.ts` plus `install-web-scrollbar-styles.web.ts`).

Otto's additions to the old component do not have an obvious home in a CSS approach:

- Drag interaction: `startWebDrag`, `dragStartClientCoordinateRef`, `readClientCoordinate`
- Opacity behaviour: `computeHandleOpacity`, `handleOpacity`
- Horizontal axis support: `isHorizontal`, `handleAxisStyle`, `thumbRegionAxisStyle`,
  `onScrollToHorizontalOffset`
- Metrics: `useWebDesktopScrollbarMetrics`, `HIDE_SCROLLBAR_STYLE_ID`
- `inlineUnistylesStyle` usage (the high-churn geometry escape hatch from `docs/unistyles.md`)

**This is the one file pair where "port onto their replacement" may not be possible.** A CSS
scrollbar cannot express custom drag handling or computed handle opacity. Related memory:
compact scrollbars and the DiffScroll horizontal overlay both depend on this component.

**Options:** (a) keep ours as an Otto-owned component and take upstream's CSS install for the
places that only need default styling; (b) drop our custom behaviour and accept upstream's CSS.
My recommendation is (a), because (b) loses the horizontal overlay and the compact-mode work.

### 5. `utils/desktop-window.ts` (+138 / −1) — clean port

Otto added **Window Controls Overlay** support: `getWindowControlsOverlay`, `overlayInsets`,
`resolveOverlayInsets`, `refreshOverlayInsets`, `useWindowControlsOverlayInsets`,
`setCachedOverlayInsets`, `startOverlayInsetsSubscription`, `startDesktopResizeReflow`.

Almost pure addition (one deleted line). **Lands in:** upstream's `desktop-window.tsx` directly.
Lowest-risk heavy file in the audit.

### 6. `git/use-github-search-query.ts` (+66 / −3) — rival abstraction, ours is broader

Otto added `hostingSearchEnabled`, `normalizeHostingSearchPayload`, `toHostingSearchKinds`,
`useHostingSearchFeature`. This is Otto's **provider-neutral git-hosting layer**
([docs/git-providers.md](../../docs/git-providers.md)): GitHub and Bitbucket Cloud behind one
interface.

Upstream shipped `git/forges/github.ts`, a forge layer of their own. Both exist to solve the same
problem, but **ours is the provider-neutral one and theirs is GitHub-shaped**. This is the forge
cautionary tale from [docs/upstream-merges.md](../../docs/upstream-merges.md) repeating.

**Lands in:** upstream's `git/forges/` structure, with our hosting abstraction as the layer above
their GitHub forge. Do not collapse Bitbucket support to make the port easier.

### 7. `git/github-url.ts` (+1 / −1)

Rebrand only. `parseGithubUrl` moved to `utils/github-refs.ts`. Trivial.

## The thirteen light files

| File                                                         | Churn     | Note                                                      |
| ------------------------------------------------------------ | --------- | --------------------------------------------------------- |
| `e2e/helpers/daemon-restart.ts`                              | +34 / −32 | Test helper rewrite; re-express against upstream's helper |
| `components/icons/editor-app-icons.tsx`                      | +24 / −5  | Lands in `components/icons/editor-target-icon.tsx`        |
| `desktop/features/editor-targets.test.ts`                    | +18 / −2  | Lands in `editor-targets/registry.test.ts`                |
| `desktop/features/editor-targets.ts`                         | +13 / −5  | Lands in `editor-targets/{registry,runtime,ipc}.ts`       |
| `hooks/use-open-project-picker.ts`                           | +12 / −4  | Small; check against upstream's project picker rework     |
| `components/command-center.tsx`                              | +9 / −5   | Lands in `command-center/command-center.tsx`              |
| `workspace/editor-targets.ts`                                | +8 / 0    | Pure addition                                             |
| `stores/workspace-tabs-store/index.ts`                       | +6 / 0    | Barrel; lands in `workspace-tabs/`                        |
| `hooks/use-command-center.ts`                                | +3 / −1   | Lands in `command-center/provider.tsx`                    |
| `components/project-picker-browse-button.electron.tsx`       | +1 / −1   | Rebrand only                                              |
| `projects/workspace-fetching.ts`                             | +1 / −1   | Rebrand only                                              |
| `utils/navigate-to-agent/restore-archived-workspace.test.ts` | +1 / −1   | Rebrand only                                              |
| `git/github-url.ts`                                          | +1 / −1   | Rebrand only (listed above)                               |

Four of these are pure rebrand and carry no Otto functionality at all.

## Decisions taken (2026-07-31, product owner)

**1. The scrollbar pair (items 3 and 4): take both.** Upstream's install is global by design, a `*`
selector injected once from `app/_layout.tsx`, so it is not a per-surface component. Ours is used in
exactly nine files:

```
components/file-explorer-pane.tsx   components/file-pane.tsx   components/image-preview.tsx
editor/definition-picker-dialog.tsx editor/editor-outline-sheet.tsx
git/diff-pane.tsx                   screens/settings-screen.tsx
```

Plan: **install upstream's global CSS, keep ours on those nine surfaces.** Every other scroll surface
in Otto (sidebar, chat, panels, modals) currently shows a default browser scrollbar and gains
upstream's themed one. Nothing Otto built is replaced, and the custom drag, opacity and
horizontal-overlay behaviour survives where it is actually used.

**Verify before calling this done:** CSS ordering between upstream's `*::-webkit-scrollbar` rule and
our `HIDE_SCROLLBAR_STYLE_ID` hide-native rule. Ours must win on the nine surfaces. If specificity
does not settle it, pin ours explicitly.

**2. The hosting layer (item 6): adopt upstream's forge layer and rebuild Bitbucket on it.**

The earlier read that upstream's layer is "GitHub-shaped" was wrong. `v0.2.5` ships **five** forges
behind `forges/index.ts` and `forges/view.ts`:

```
github.ts  gitlab.ts  gitea.ts  forgejo.ts  codeberg.ts   (each with a .view.tsx)
```

Their abstraction is broader than Otto's two-provider layer, so this is a net gain rather than a
concession: Bitbucket becomes a sixth forge under an established pattern, and Otto picks up GitLab,
Gitea, Forgejo and Codeberg support it does not have today.

**Verify before calling this done:** Bitbucket Cloud must keep working end to end. Re-deriving it on
upstream's abstraction is the risk in this item; see [docs/git-providers.md](../../docs/git-providers.md)
for the behaviour that has to survive.

Everything else in this audit has an unambiguous destination and can be ported without further input.

## OPEN: Bitbucket re-attachment (the one real regression risk in this merge)

**Status: the structural half is done, the wiring half is NOT.** `workspace-git-service.ts` has been
resolved to upstream's forge-based rewrite (their churn 459/220 vs ours 297/55), which is the agreed
direction. Their version generalises every GitHub-specific symbol:

```
latestGithub -> latestForge          getGitHubPollKey -> getForgePrStatusPollKey
buildGitHubSnapshot* -> buildForgeSnapshot*
githubRemote: GitHubRemoteIdentity -> forgeService: ForgeService
snapshot.github -> snapshot.forge
```

**Upstream's version contains zero references to Otto's `GitHostingResolver`.** Otto's
provider-neutral hosting layer (`packages/server/src/services/git-hosting/`, with
`bitbucket-cloud-service.ts`, `router.ts`, `resolver.ts`, `status-poller.ts`) survives on disk and is
still wired in `bootstrap.ts`, but it is **no longer feeding the checkout status path**.

Mitigation applied so far: upstream's `forge` snapshot shape has been extended with Otto's three
fields (`provider?: GitHostingProviderId`, `capabilities?: GitHostingCapabilities`,
`credentialsMissing?: boolean`) so the types and the wire projection still line up, and
`status-projection.ts` keeps every Otto feature (`gitStateAt` stamping, `isOttoOwnedWorktree`,
`buildBaseProvenanceFields`) while reading `snapshot.forge`. **Those three fields are currently never
populated**, so they arrive `undefined`.

**Re-attachment checklist:**

1. ✅ **Re-accept the hosting resolver as a dependency.** `resolveHostingForCwd?` added to the git
   service deps, deliberately as a _separate seam_ from upstream's `forgeOverrides` — upstream's
   forge registry has no equivalent of the typed provider id + capabilities.
2. ✅ **Populate the three fields.** Done where the snapshot is stored and `target.cwd` is in scope:
   `target.latestForge = { ...forgeSnapshot, forge: resolution.forge, ...hostingFields }`. A failure
   in the hosting resolver is caught and must not lose the forge snapshot.
3. ✅ **`bootstrap.ts` wiring.** Now passes BOTH `forgeOverrides: { github }` (upstream's injection
   seam, taking our `createGitHostingRouter` as the GitHub adapter) and our `resolveHostingForCwd`.
   The stale bare `github` dep was dropped — upstream's deps have no such field and
   `this.deps.github` had zero uses.
4. ⬜ **Verify the client.** `packages/app/src/git/use-pr-status-query.ts` consumes `capabilities`;
   it should now receive them again, but this has not been exercised.
5. ⬜ **Hard gate: Bitbucket Cloud end to end** — resolve a Bitbucket remote, list and open a PR, and
   confirm the checkout status shows the right provider and capabilities. See
   [docs/git-providers.md](../../docs/git-providers.md).

The wiring is restored, but **until steps 4 and 5 are exercised, treat Bitbucket as unverified rather
than shipped.** Nothing here has been run against a real Bitbucket remote.
