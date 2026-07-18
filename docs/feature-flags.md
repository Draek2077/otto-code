# Feature flags (gated features)

A **gated feature** is an optional, self-contained subsystem the user can turn off entirely — not merely hidden from the UI, but **kept out of memory**: a disabled feature's panel module is never `import()`-ed, so its code (and any heavy assets it transitively loads) never enters the JS heap. The founding member is the **Visualizer**; more slot in by adding a `FeatureId` and a catalog entry.

This exists because Otto aims to stay lightweight — a user who doesn't want a feature shouldn't pay for it. The mobile/web/desktop client bundles everything statically by default, so "not loaded" requires a deliberate lazy boundary (see the Metro constraint below).

## The one hard constraint: Metro doesn't tree-shake by runtime flag

React Native / Expo (Metro) evaluates **every statically-`import`ed module at startup**, regardless of any runtime boolean. A feature flag that only guards `if (enabled)` still ships and parses the feature's code. The **only** lever that keeps code out of the heap is a **dynamic `import()` boundary** (`React.lazy`, or a bare `import()`), which Metro splits into a chunk fetched on demand. Every "not even loaded" guarantee in this system reduces to: _put the heavy module behind a lazy boundary, and don't render the thing that triggers it while the feature is off._

Corollary: **restart is not required for correctness.** The lazy boundary makes "disabled ⇒ never imported" hold live, because the disabled path simply never renders the lazy element. Restart is only relevant if you (wrongly) gate with a static import.

## Anatomy (`packages/app/src/features/`)

- **`feature-catalog.ts`** — the registry. `FeatureId` union, `FEATURE_IDS`, and `FEATURE_CATALOG` (per feature: `label`, `description`, `panelKinds`, `defaultEnabled`). A **leaf module**: it imports only the `WorkspaceTabTarget["kind"]` _type_ (erased at runtime), so settings storage can import it with no cycle.
- **`use-feature-enabled.ts`** — the single gate. `useFeatureEnabled(id)` (reactive), `getFeatureEnabledSnapshot(id)` (imperative, for gate sites outside React — e.g. `openVisualizerTab`), and `resolveFeatureEnabled(settings, id)`. **Resolution rule: a missing key ⇒ the feature's own `defaultEnabled`** (all-on today), so new features default on and pre-existing devices are unaffected. Mirrors `use-interface-mode.ts` exactly.
- **`use-close-disabled-feature-tabs.ts`** — the reaper. Mounted once high in the workspace tree (`WorkspaceScreenContent`); when a feature is turned off it closes any open tabs of that feature's `panelKinds` across **every** workspace, so a disabled feature vanishes without a restart.
- **`feature-disabled-panel.tsx`** — the safety net. Rendered in place of a disabled feature's panel for the instant before the reaper closes its tab (and on any surface where the reaper isn't mounted). It never references the feature's lazy panel, so the heavy module is never imported while disabled.

## Persistence

`featureEnabled: Partial<Record<FeatureId, boolean>>` on `AppSettings` (device-local presentation only — never synced to the daemon, never per-workspace). **Sparse by design**: only explicit user choices are stored; a missing key falls back to `defaultEnabled`. The storage validator (`pickFeatureFlagSettings` in `hooks/use-settings/storage.ts`) keeps only known `FeatureId` keys with boolean values, so a corrupt/legacy blob can't inject junk (tested in `storage.test.ts`).

## Wiring a feature through the gate (Visualizer as the reference)

1. **Split the panel.** The heavy panel (`panels/visualizer-panel.tsx`) exports its component; a **thin registration module** (`panels/visualizer-panel-registration.tsx`) holds the light descriptor (label + icon) and a `React.lazy(() => import("…/visualizer-panel"))`. `register-panels.ts` imports the **thin** module. That single redirect is what code-splits the heavy module out of the startup graph — confirm with a grep that nothing else statically imports the heavy module.
2. **Guard the lazy render.** The thin module's host component reads `useFeatureEnabled(id)`; when off it returns `<FeatureDisabledPanel>` and **never references the lazy element**, so `import()` never fires.
3. **Gate the entry points.** Hide the reactive UI controls (header button in `workspace-screen.tsx`, the Runs "Visualize" action in `runs-screen.tsx`) with `useFeatureEnabled`, and refuse centrally in the imperative open path (`openVisualizerTab` → `getFeatureEnabledSnapshot`). Central refusal is the backstop; hiding controls is the polish.
4. **Add the settings toggle.** A master switch in the feature's own settings section (`screens/settings/visualizer-section.tsx`), gating the rest of the section.

## Adding a new gated feature

Add the `FeatureId` + a `FEATURE_CATALOG` entry, split its panel behind a thin lazy registration, gate its entry points, and add its settings toggle. No new storage plumbing — `featureEnabled` already covers it. Keep the split honest: if any module statically imports the heavy panel, the code-split silently breaks.
