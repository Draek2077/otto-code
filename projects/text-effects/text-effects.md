# Text effect themes

Selectable themes for the "working" text effect — the light sweep that plays across
tool-call / activity labels while an agent is running. One picker in Appearance
settings; the current effect stays the untouched default.

## Where the effect lives

`packages/app/src/components/message.tsx` — `ExpandableBadge` renders the shimmer
whenever `isLoading` is true (tool calls with status `running`/`executing`, reasoning
blocks streamed as `toolName="thinking"`, and collapsed action groups with an active
member). Two platform implementations, both off the JS thread:

- **Web**: a CSS keyframe animation (`otto-toolcall-shimmer`) sweeping a
  `background-clip: text` gradient across the label via `background-position`
  (per-element start/end CSS vars). Zero per-frame JS.
- **Native**: `MaskedView` (text as mask) over a reanimated `withRepeat(withTiming)`
  translateX of an SVG gradient peak. UI-thread worklet, no per-frame JS.

## Effect-theme API

`packages/app/src/styles/text-effects.ts` is the registry. Everything is static data —
specs are module-level constants, so component memos keyed on a spec reference never
churn.

`TextEffectSpec` is a discriminated union over two animated primitives:

```ts
type TextEffectActivity =
  | "thinking" | "read" | "edit" | "write" | "search" | "web"
  | "command" | "browser" | "agent" | "other";

interface SweepTextEffectSpec {                   // the original primitive
  kind: "sweep";
  webGradient: string;                            // CSS gradient for the sweeping peak
  nativeStops: readonly TextEffectGradientStop[]; // same peak as SVG <Stop>s
  bounce: boolean;                                // back-and-forth vs one-way sweep
  easing: "linear" | "ease-in-out";
  durationScale: number;                          // 1 = today's speed
  peakScale: number;                              // 1 = today's peak width
}

interface GlyphTextEffectSpec {                   // glyph rain overlay (Matrix)
  kind: "glyph";
  headColor: string;                              // a glyph that has just arrived
  tailColor: string;                              // the one behind it, fading
  cellWidth: number;                              // column pitch in px
  cycleSeconds: number;                           // one pass over a single column
  staggerSeconds: number;                         // lag between adjacent columns
  scrambleAlphabet: string;
}

type TextEffectSpec = SweepTextEffectSpec | GlyphTextEffectSpec;

getTextEffectSpec(themeId, activity): TextEffectSpec  // per-activity override or theme default
```

A theme is `{ default: TextEffectSpec; byActivity?: Partial<Record<TextEffectActivity, TextEffectSpec>> }`.
**Adding a sweep theme = add an id + one registry entry + one settings label.** Activities
map from the existing `ActionGroupCategory` (`agent-stream/action-grouping.ts`,
`textEffectActivityForToolName/Category`), so new tools classify for free.

### The glyph branch

**The glyph branch never touches the text.** It is decoration drawn _over_ the label: a
horizontal strip of random glyphs travelling across it, one line tall, clipped to the row.
The label stays a single untouched `<Text numberOfLines={1}>` — same colour, same ellipsis,
same selection, same layout. Nothing reads, splits, or replaces the characters; the
"scramble" is an illusion produced by an unrelated overlay.

That is also why it is cheap: the rain is a fixed-pitch row of columns sized to the
measured text span, so a 4-character label and a 40-character one cost the same per column,
and the label's content is not an input to the animation at all (only a `seed` that varies
which glyphs appear, so two badges running at once don't show the same rain).

`ExpandableBadge` picks a branch with `resolveTextEffectBranches`; the sweep path is
untouched by all of this. The renderers live in `components/text-effect-rain.{tsx,web.tsx}`,
sharing `text-effect-rain.shared.ts` (column construction, the deterministic glyph pick,
the styles).

One timeline, `GLYPH_EFFECT_PHASES` in the registry, drives both platforms so they cannot
drift: a column flashes one glyph at `headColor`, hard-cuts to a second at `tailColor`, and
that one fades out — the fade is the trail. What makes it travel is that column _i_ runs
the same timeline offset by `i * staggerSeconds`; `(fade - arrive) * cycleSeconds /
staggerSeconds` is how many columns are lit at once, i.e. how wide the strip reads.

- **Web**: two keyframes registered once for the whole app; per column the only variable is
  a negative `animation-delay`. Colours are set per element, so the keyframes stay
  theme-independent. No JS per frame, no state.
- **Native**: one shared value per badge — a linear 0→1 sawtooth — and every column derives
  its own style from it by subtracting its staggered phase. One animation driver per badge,
  worklets on the UI thread, no re-render while the strip travels.

`MAX_RAIN_COLUMNS` (48) caps animated columns; a very wide badge gets a shorter strip
rather than hundreds of worklet evaluations. The text span (`textSpanStartX` /
`textSpanWidth` out of `computeShimmerMetrics`) is now measured on **both** platforms —
the web sweep needed it for its track, the rain needs it on native too.

Deliberately horizontal: this rides a single-line label, so there is nowhere for a vertical
drip to go. If a _geometric_ wave (glyphs displaced vertically in a sine) is ever wanted, it
belongs on this branch as a new glyph theme — not as a change to `wave`, which is a colour
wave by design.

## The themes

| Theme                  | Palette                                          | Pattern                                      | Notes                                                                                                       |
| ---------------------- | ------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Professional (default) | white peak (today's exact gradients)             | sweep                                        | byte-identical to current behavior                                                                          |
| Active                 | white, wider solid core, stronger edges          | sweep                                        | ~1.6x faster, wider peak                                                                                    |
| Spectrum               | rainbow multi-stop band                          | sweep                                        | wide band, slightly slower so hues read                                                                     |
| Vivid                  | original sweep shape, saturated hue per activity | sweep                                        | thinking violet, read blue, edit green, command orange, search amber, web cyan, browser magenta, agent pink |
| Night Rider            | red glow                                         | bounce (alternate / `withRepeat(..., true)`) | ease-in-out scan, K.I.T.T.                                                                                  |
| Wave                   | blue swell alternating light/dark                | sweep                                        | widened so several crests sit on the label at once — a colour wave, not a geometric one                     |
| Flames                 | white-hot tip → orange → charred ember           | sweep                                        | asymmetric front; glyphs read as burned behind it                                                           |
| Matrix                 | green rain over the untouched label              | **glyph** (rain overlay)                     | horizontal strip of random glyphs travelling across the text span; the only non-sweep theme                 |

Colors are literal mid-saturation hues (like today's literal white) clipped onto the
text glyphs, chosen to read over light, dark, and black backgrounds — no theme-token
subscription needed. If a palette ever needs per-scheme variants, extend the spec with
a light/dark stop pair; do not add a `useUnistyles()` call (banned, docs/unistyles.md).

## Selection + persistence

- Device-local `AppSettings.textEffectTheme` (`hooks/use-settings/storage.ts`), default
  `"professional"`, validated on load like every other enum field.
- `useTextEffectThemeId()` (`hooks/use-text-effect-theme.ts`) reads it via the settings
  react-query cache with a `select`, so badges only re-render when the picked theme
  actually changes — never per settings write, never per frame.
- Picker: "Text effects" dropdown row in Settings → Appearance → Agents
  (`screens/settings/appearance/appearance-section.tsx`).

## Performance constraints (hard)

- Both platform paths stay declarative: theme choice only swaps static gradient
  strings/stop arrays and animation parameters. No per-frame JS, no per-chunk
  re-renders, no new work during streaming.
- Reduced motion: unchanged from today — native reanimated timing keeps its
  `ReduceMotion.System` default (freezes under OS reduced-motion); web CSS animation
  matches previous behavior.
