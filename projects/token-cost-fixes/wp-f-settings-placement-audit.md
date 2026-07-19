# WP-F · Settings placement audit

> Wave 2 (after WP-A defines the pattern). Cross-cutting cleanup. Parent:
> [token-cost-fixes.md](token-cost-fixes.md).

## Goal

Enforce the rule: **daemon settings live in Host settings** (`MutableDaemonConfig` via
`useDaemonConfig`/`patchConfig`, persisted host-side to `config.json`); **frontend/
presentation settings live in App settings** (`AppSettings` via `useAppSettings`,
device-local AsyncStorage). Sweep for and correct existing misplacements.

## Method

1. Enumerate every setting surfaced in the app: Host settings pages
   (`packages/app/src/screens/settings/host-page.tsx`) and App/general settings
   (`packages/app/src/screens/settings-screen.tsx`, `use-settings/`, `storage.ts`).
2. For each, classify: does it change **daemon behavior** (belongs in Host / `MutableDaemonConfig`)
   or **only client presentation** (belongs in App / `AppSettings`, device-local)?
3. Flag straddles. Known example from the map: `promptSuggestionsEnabled` is app-local
   (`storage.ts:110-113`) but gates a host capability — after WP-A/WP-E, the _generation_
   toggle is daemon-side (`agentBehaviors.promptSuggestions`) and the _render_ toggle stays
   app-local; confirm the split reads cleanly and isn't duplicated/contradictory.
4. Propose (and where safe, apply) moves: a misplaced daemon setting → Host + the config
   chain; a misplaced presentation setting → App. Preserve back-compat (don't orphan a
   persisted value; migrate or alias).

## Constraints

- This is primarily an **audit + low-risk corrections** pass — do not rip out settings that
  are correctly placed, and don't collide with WP-A's new cards (those are already correct
  by construction).
- Any daemon-side move must go through the full config chain (see WP-A doc) and stay
  additive/back-compat.
- Do **not** commit. `npm run typecheck` + `npm run lint -- <changed files>`.

## Deliverable

`wp-f-findings.md`: a table of every setting → current placement → correct placement →
action (ok / moved / flagged-for-decision), plus any low-risk corrections applied.
