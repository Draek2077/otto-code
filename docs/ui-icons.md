# UI Icons

General UI icons (chevrons, kebab menus, settings gear, buttons, etc.) come from
[Material Symbols](https://github.com/marella/material-symbols) (installed as
`@material-symbols/svg-400`, a dev dependency in `packages/app`), not a font or icon
library imported at runtime. This is unrelated to `material-icon-theme`, which is scoped
only to file-type icons in the file explorer - see [file-icons.md](file-icons.md).

Icons are vendored as monochrome SVG strings, generated once and committed:

```
packages/app/scripts/material-symbols-map.json       - lucide-style name -> Material Symbol key
packages/app/scripts/generate-material-symbols.mjs    - codegen script
packages/app/src/assets/material-symbol-icons.ts      - generated SVG strings (do not edit by hand)
packages/app/src/components/icons/material-icons.ts   - the actual icon components consumed by the app
```

## How it works

- `material-symbols-map.json` maps a name (e.g. `"ChevronRight"`) to a Material Symbols
  outlined-family key (e.g. `"chevron_right"`). A key can end in `-fill` to pull the
  filled variant instead (e.g. `"square-fill"`), or start with a `"700:"` prefix to pull
  the bold weight instead of the default 400 (e.g. `"700:home"` for `HomeBold`), from the
  separate `@material-symbols/svg-700` package (weight is baked into the path geometry,
  not a runtime stroke-width toggle).
- `generate-material-symbols.mjs` reads each SVG from
  `node_modules/@material-symbols/svg-<weight>/outlined/<key>.svg`, injects
  `fill="currentColor"` on the root `<svg>` (the source files ship with no fill, which
  defaults to black), and writes `MATERIAL_SYMBOL_SVGS: Record<string, string>` to
  `material-symbol-icons.ts`.
- `material-icons.ts` exports one `IconComponent` per entry in the map. Each renders its
  vendored SVG through `react-native-svg`'s `<SvgXml>`, the same recoloring mechanism
  already used for provider logos in `provider-icons.ts` - `SvgXml`'s `color` prop
  resolves any `currentColor` reference in the SVG, so icons take on whatever color the
  caller passes, exactly like a font icon would.
- Every exported icon has the signature `{ size: number; color: string; style?: StyleProp<ViewStyle> }`
  (both `size` and `color` are **required**, not optional - matching the various
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

## Reserved glyphs

A few concepts own a glyph app-wide, so the same idea reads the same everywhere. Do
not spend these on anything else, and do not draw the concept with a different icon.

| Concept               | Icon                             | Where it appears                                                                                           |
| --------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Skill                 | `Handyman` (`handyman`)          | Settings → Integrations skills row, the chat tool-call rail for `Skill` calls, any future skill UI         |
| Background generation | `Robot` (`robot_2`)              | The `generation` usage kind - the Usage ledger row and the Stats "Background generations" tile             |
| AI assistance         | `Sparkles` (`robot_2`)           | The `sparkles` tool-call glyph and the "sparkles" agent-profile cell - the same robot head as above        |
| Otto Brain            | `Brain` (`network_intelligence`) | The Brain rail button and its state glyphs, the Brain settings section and screen, the Brain provider mark |

`Brain` is the strictest of these: the circuit brain means **Otto Brain specifically**, so
"where is the Brain page" never moves. Any other brain - a personality glyph, a thinking
badge, a generic cognition cue - uses `Neurology` (`neurology`) instead. The Brain rail's
own state variants (`BrainError`, `BrainDownload`, `BrainScan`, `BrainBenchmark`,
`BrainCalibrate`, `BrainSweep`) belong to the same reservation.

The `artificer` personality role used to wear `Handyman`; it moved to `Architecture` when
the skill reservation landed. See `packages/app/src/provider-selection/role-icons.ts`.

Skill tool calls resolve their glyph client-side in `tool-call-icon-name.ts`, from the
tool name, not from the wire. `ToolCallIconName` is a `z.enum` on the WebSocket schema
(`messages.ts`), so `handyman` is added to the client-only `ToolCallIcon` union next to
`otto` rather than to the protocol enum - an old client must never meet an icon name it
cannot parse.

## Why "outlined", unfilled by default

Material Symbols ships three families (`outlined`, `rounded`, `sharp`) and a filled
variant of each icon. `outlined` unfilled was chosen because it's the closest visual
match to the line-icon look the app already had. A handful of icons intentionally use
the `-fill` source (e.g. `Square` for the record/stop button, `CheckCircle2` for a solid
checkmark, `StarFilled` for a favorited star) because those spots always want a solid
glyph, not because the icon set generally favors filled icons.

## Approximated icons

Material Symbols has no exact equivalent for a few concepts, so these are deliberate
closest-fit substitutions, not bugs: `MicVocal` → `record_voice_over`, `PackagePlus` →
`package_2` (no plus-badge variant), `Compass` → `explore`, `Hammer` → `gavel` (the set
has no plain hammer), `FolderMinus` → `unfold_less` (drawn as the collapse gesture rather
than a folder), `FileWarning` → `report`, `Microscope` → `biotech`, `CircleDashed` →
`data_usage`.

## The one exception: git glyphs come from lucide

Everything above is Material Symbols. The git family is the single exception and lives in
`packages/app/src/components/icons/lucide.ts`:

`GitBranch`, `GitCommitHorizontal`, `GitMerge`, `GitPullRequest`, `GitPullRequestClosed`,
`GitPullRequestDraft`, `Github`.

Material has no distinct pull-request glyph, let alone one per state: open, closed and
draft all collapse onto `call_merge`, which draws an open PR and a closed PR identically
in the same sidebar row, and `Github` had to fall back to a generic `code`. Lucide draws
all four states apart and ships a real GitHub mark, so the git family stays there until
Material grows real equivalents.

Rules for that file:

- Do not add non-git glyphs to it. Everything else goes through
  `material-symbols-map.json` and `material-icons.ts`.
- Import git glyphs from the barrel, never from `lucide-react-native` directly. Lucide
  types its own `size` as `string | number`, so a size token handed to a raw lucide icon
  type-checks and then silently renders at lucide's default 24. The barrel wraps each one
  in `withIconSizeToken` so that cannot happen.
- Lucide icons accept props Material ones do not (`strokeWidth`, arbitrary a11y props).
  Do not rely on those at a call site that might later swap families; put an
  `accessibilityLabel` on a wrapper `View` instead, the way `file-change-icon.tsx` does.
- When Material does grow pull-request glyphs, deleting this file also removes
  `lucide-react-native` from `packages/app/package.json`, the `test-stubs/lucide-react-native.ts`
  stub, and its alias in `vitest.config.ts`.
