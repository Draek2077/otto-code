# Expo Router

Otto's mobile route tree is fragile because Expo Router and React Navigation do
not fail loudly when a nested native route is mounted under the wrong layout. The
usual symptom is a white or blank native screen with no JavaScript crash.

Read this before changing `packages/app/src/app`, startup routing, remembered
workspace restore, or active workspace selection.

## Ownership

Each layout owns only the routes directly inside its directory.

- The root layout registers `h/[serverId]`.
- The root layout does not register host leaf routes such as
  `h/[serverId]/workspace/[workspaceId]`, `h/[serverId]/open-project`, or
  `h/[serverId]/index`.
- `packages/app/src/app/h/[serverId]/_layout.tsx` owns the host leaves with
  relative screen names: `index`, `workspace/[workspaceId]/index`,
  `agent/[agentId]`, `sessions`, `open-project`, `settings`,
  `plugin/[pluginId]/[surfaceId]`, and
  `plugin/[pluginId]/[contributionKind]/[contributionId]`.

Expo Router warns with `[Layout children]: No route named ...` when a layout
registers grandchildren. Treat that warning as a route-tree bug. On native, that
shape can leave a nested index route mounted without its local dynamic params and
render a blank screen.

## Startup

The root `/` route chooses a host boundary. It does not jump directly into a host
leaf.

- Good: `/` -> `/h/[serverId]`
- Bad: `/` -> `/h/[serverId]/workspace/[workspaceId]`

`/h/[serverId]` is the host home route. The host index restores the last
remembered workspace for that host after the remembered selection has hydrated
and the workspace has not been proven missing. If there is no restorable
workspace, it goes to global `/open-project`.

This restore is based on the last navigated workspace, not current connection
status. Do not redirect to another online host just because the remembered host
is still connecting or offline; the workspace screen owns that offline/loading
state.

This split is deliberate. The host layout must mount first so native local
dynamic params exist before any nested workspace leaf is selected.

## App-Wide Route Hops

When app-wide routes such as `/new`, `/settings`, or `/sessions` navigate back
into a host workspace, use `navigateToWorkspace()`. Do not make the caller
branch on its current route.

Pass only `serverId` and `workspaceId` for normal attention-aware navigation.
When the action names a specific tab, pass it as `target`; that explicit choice
is authoritative. Callers should not choose between separate route and tab
navigation APIs.

The root stack owns `h/[serverId]`; the host stack owns
`workspace/[workspaceId]/index`. Repeated global-route hops must `POP_TO` the
root host route and pass the nested workspace screen when a host route is
already mounted, or Expo Router can append extra hidden workspace deck entries.
The workspace navigation helper inspects the mounted navigation state to make
that decision; if no host route is mounted yet, it falls back to ordinary route
navigation.

Those hidden entries are not harmless: composer floating panels can measure
against the wrong deck and disappear offscreen.

Hidden host routes may keep their local params while an app-wide route is
foregrounded. Active-workspace observers must prefer the current pathname and
only use local param fallback during cold mount (`/` or empty pathname), or a
hidden workspace can overwrite the remembered workspace before Settings or
History returns.

## Agent Targets

Notifications and agent URLs enter the router with different authoritative
targets.

- Notifications carry `serverId`, `workspaceId`, and `agentId`. Route them
  directly to the workspace with the agent open intent.
- Agent URLs carry only `serverId` and `agentId`. Route them through
  `/h/[serverId]/agent/[agentId]`; that route waits for the named host, resolves
  the agent's workspace from the host, and then opens the agent there.

Both paths converge on `navigateToAgent()`. Do not make notification routing
guess a workspace, and do not add a workspace to the stable agent URL format.

## Params

Required dynamic params belong to the matched route.

Do not paper over missing required params by reading global params in the leaf.
If `useLocalSearchParams()` misses a required param, fix layout ownership or the
startup route shape.

Use the host route context for host-owned leaves that need the host id after
`h/[serverId]/_layout.tsx` has matched. Do not make a leaf recover from an
unmatched tree by guessing from global state.

## App Directory

Keep non-route modules out of `src/app`. Expo Router treats ordinary `.ts` and
`.tsx` files there as routes, which produces `missing the required default
export` warnings and pollutes the route tree.

Put shared route policy in `src/navigation`, `src/utils`, stores, or another
non-route directory.

## A New Top-Level Route Is Registered in TWO Places

Dropping a file into `src/app` is not enough for a top-level screen. `_layout.tsx`
gates two separate things, and missing either one fails quietly:

1. **`RootStack`** - add a `<Stack.Screen name="your-route" />`. Most go inside
   the `<Stack.Protected guard={storeReady}>` block.
2. **`AppWithSidebar.shouldShowAppChrome`** - an explicit pathname allow-list
   (`/open-project`, `/new`, `/new-project`, `/sessions`, …). It drives
   `chromeEnabled`, which decides whether the **left sidebar renders at all** and
   whether **keyboard shortcuts are live**.

Miss #2 and the screen still mounts and works - it just has no sidebar and no
shortcuts. On desktop that means a page the user **cannot navigate away from**,
with a stranded sidebar-toggle button in the header that toggles nothing. It
looks like a styling bug and is actually a routing one, so check the allow-list
before you go hunting in the screen.

The allow-list is a known wart (there is already a TODO on `chromeEnabled` about
conflating workspace chrome with global concerns). Until it is split, adding a
route means editing both places.

## Scene Background Is the Navigation Theme, Not contentStyle

Every stack scene wraps its content in `@react-navigation/elements`'
`Background`, which paints `colors.background` from the **React Navigation
theme** - a separate theming system from Unistyles. Without a provider that is
the default light theme's near-white, and it is what flashes while a heavy
screen (the workspace deck) cold-mounts on top of it.

`RootStack` in `packages/app/src/app/_layout.tsx` therefore wraps the root
`Stack` in a `ThemeProvider` whose `colors.background` is the Unistyles
`surface0` (plus `card`/`text`/`border`/`primary`). The provider covers every
nested navigator, including the host stack.

Do not try to fix a white scene flash with `contentStyle` on a nested stack:
`contentStyle` styles a `View` _inside_ the scene, and making it transparent
just exposes the `Background` layer underneath. Fix the navigation theme.

## Native Stack

Keep workspace identity and retention outside native-stack `getId` and
`dangerouslySingular`. Expo Router maps `dangerouslySingular` to React
Navigation `getId`, and `getId` has broken Android native-stack/Fabric by
reordering an already-mounted workspace screen.

Use `ThemedStack` from `packages/app/src/navigation/themed-stack.tsx` for every
Expo Router stack. React Navigation otherwise paints each native stack screen
with its light default background. A screen-level wrapper can hide that surface
while settled, but Android may expose it for one frame when navigation crosses
from a nested stack to its parent stack. This is especially visible when an
app-wide route such as `/new` opens from a dark workspace.

Do not read the active theme with `useUnistyles()` in a layout to build
`screenOptions`. `ThemedStack` keeps that third-party prop theme-reactive through
a small `withUnistyles` boundary without subscribing the route tree itself to
every Unistyles runtime update.

## Regression Shape

Pure helper tests are useful but not enough. The failure mode here is native
route-tree state, so a real regression should launch native with seeded persisted
state:

1. Seed `otto:last-workspace-route-selection` with a valid
   `{ serverId, workspaceId }`.
2. Launch the native app cold.
3. Assert a real screen is visible, not the blank tree.
4. Assert no `[Layout children]` warning appears.

The pure policy tests should still enforce the boundary split:

- root startup with a saved workspace returns `/h/[serverId]`;
- host index with the same saved workspace returns
  `/h/[serverId]/workspace/[workspaceId]`;
- host index with no restorable workspace returns `/open-project`.

## Checklist

Before landing route changes:

- [ ] Did you change `packages/app/src/app`? Re-read this file.
- [ ] Did you touch remembered workspace restore? Keep root on `/h/[serverId]`.
- [ ] Did a route return to a workspace? Use `navigateToWorkspace()` and pass a
      `target` when the action names a specific tab.
- [ ] Did you add a route? Register it in the layout that directly owns it.
- [ ] Did you add a **top-level** route? Also add it to `RootStack` AND to
      `shouldShowAppChrome` - or it renders with no sidebar and no way out.
- [ ] Did `useLocalSearchParams()` lose a required param? Fix the route tree.
- [ ] Did native show a blank screen without a crash? Suspect route ownership
      before stores, themes, or rendering.
