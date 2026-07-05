# UI Icons

General UI icons (chevrons, kebab menus, settings gear, buttons, etc.) come from
[Material Symbols](https://github.com/marella/material-symbols) (installed as
`@material-symbols/svg-400`, a dev dependency in `packages/app`), not a font or icon
library imported at runtime. This is unrelated to `material-icon-theme`, which is scoped
only to file-type icons in the file explorer — see [file-icons.md](file-icons.md).

Icons are vendored as monochrome SVG strings, generated once and committed:

```
packages/app/scripts/material-symbols-map.json       — lucide-style name -> Material Symbol key
packages/app/scripts/generate-material-symbols.mjs    — codegen script
packages/app/src/assets/material-symbol-icons.ts      — generated SVG strings (do not edit by hand)
packages/app/src/components/icons/material-icons.ts   — the actual icon components consumed by the app
```

## How it works

- `material-symbols-map.json` maps a name (e.g. `"ChevronRight"`) to a Material Symbols
  outlined-family key (e.g. `"chevron_right"`). A key can end in `-fill` to pull the
  filled variant instead (e.g. `"square-fill"`).
- `generate-material-symbols.mjs` reads each SVG from
  `node_modules/@material-symbols/svg-400/outlined/<key>.svg`, injects
  `fill="currentColor"` on the root `<svg>` (the source files ship with no fill, which
  defaults to black), and writes `MATERIAL_SYMBOL_SVGS: Record<string, string>` to
  `material-symbol-icons.ts`.
- `material-icons.ts` exports one `IconComponent` per entry in the map. Each renders its
  vendored SVG through `react-native-svg`'s `<SvgXml>`, the same recoloring mechanism
  already used for provider logos in `provider-icons.ts` — `SvgXml`'s `color` prop
  resolves any `currentColor` reference in the SVG, so icons take on whatever color the
  caller passes, exactly like a font icon would.
- Every exported icon has the signature `{ size: number; color: string; style?: StyleProp<ViewStyle> }`
  (both `size` and `color` are **required**, not optional — matching the various
  `LeftIcon`/`PanelIconProps`/`ToolCallIconComponent`-style slots elsewhere in the app that
  plug icons into buttons, panels, and menus). `style` is supported for icons that need a
  transform (e.g. a spinning refresh icon).

## Adding or changing an icon

1. Find the source SVG under `node_modules/@material-symbols/svg-400/outlined/` (browse
   the folder, or `ls node_modules/@material-symbols/svg-400/outlined | grep <keyword>`).
   Filenames match Google's Material Symbols names (snake_case), not lucide's PascalCase.
2. Add or update the entry in `packages/app/scripts/material-symbols-map.json`.
3. Regenerate: `node packages/app/scripts/generate-material-symbols.mjs`.
4. Add the corresponding `export const Foo = createMaterialSymbolIcon("Foo");` line to
   `packages/app/src/components/icons/material-icons.ts`.
5. Run `npm run typecheck`.

## Why "outlined", unfilled by default

Material Symbols ships three families (`outlined`, `rounded`, `sharp`) and a filled
variant of each icon. `outlined` unfilled was chosen because it's the closest visual
match to the line-icon look the app already had. A handful of icons intentionally use
the `-fill` source (e.g. `Square` for the record/stop button, `CheckCircle2` for a solid
checkmark, `StarFilled` for a favorited star) because those spots always want a solid
glyph, not because the icon set generally favors filled icons.

## Approximated icons

Material Symbols has no exact equivalent for a few concepts the app previously drew from
lucide (mostly git-specific glyphs). These are deliberate closest-fit substitutions, not
bugs: `GitBranch` → `fork_right`, `GitMerge`/`GitPullRequest`/`GitPullRequestClosed`/`GitPullRequestDraft`
→ `merge`/`call_merge` (Material has no distinct "closed" or "draft" PR glyph), `Github`
→ `code` (no generic brand mark in the set), `MicVocal` → `record_voice_over`,
`PackagePlus` → `package_2` (no plus-badge variant).
