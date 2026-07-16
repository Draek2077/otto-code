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

```ts
type TextEffectThemeId = "professional" | "active" | "spectrum" | "vivid" | "nightRider";
type TextEffectActivity =
  | "thinking" | "read" | "edit" | "write" | "search" | "web"
  | "command" | "browser" | "agent" | "other";

interface TextEffectSpec {
  webGradient: string;                        // CSS gradient for the sweeping peak
  nativeStops: readonly TextEffectGradientStop[]; // same peak as SVG <Stop>s
  bounce: boolean;                            // back-and-forth vs one-way sweep
  easing: "linear" | "ease-in-out";
  durationScale: number;                      // 1 = today's speed
  peakScale: number;                          // 1 = today's peak width
}

getTextEffectSpec(themeId, activity): TextEffectSpec  // per-activity override or theme default
```

A theme is `{ default: TextEffectSpec; byActivity?: Partial<Record<TextEffectActivity, TextEffectSpec>> }`.
**Adding a 6th theme = add an id + one registry entry + one settings label.** Activities
map from the existing `ActionGroupCategory` (`agent-stream/action-grouping.ts`,
`textEffectActivityForToolName/Category`), so new tools classify for free.

## The 5 themes

| Theme                  | Palette                                          | Pattern                                      | Notes                                                                                                       |
| ---------------------- | ------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Professional (default) | white peak (today's exact gradients)             | sweep                                        | byte-identical to current behavior                                                                          |
| Active                 | white, wider solid core, stronger edges          | sweep                                        | ~1.6x faster, wider peak                                                                                    |
| Spectrum               | rainbow multi-stop band                          | sweep                                        | wide band, slightly slower so hues read                                                                     |
| Vivid                  | original sweep shape, saturated hue per activity | sweep                                        | thinking violet, read blue, edit green, command orange, search amber, web cyan, browser magenta, agent pink |
| Night Rider            | red glow                                         | bounce (alternate / `withRepeat(..., true)`) | ease-in-out scan, K.I.T.T.                                                                                  |

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
