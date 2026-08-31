# Unistyles Gotchas

This app uses [`react-native-unistyles` v3](https://www.unistyl.es/) for theme-aware styles. Unistyles is fast because most style updates do not go through React renders: the [Babel plugin](https://www.unistyl.es/v3/other/babel-plugin) rewrites React Native component imports, attaches style metadata, and lets the native ShadowRegistry update tracked views when theme or runtime dependencies change.

That model is powerful, but it has sharp edges. Use this note when adding theme-dependent styles.

## STOP - `useUnistyles()` Is Banned

**Do not call `useUnistyles()`. Anywhere. New code MUST NOT add a call; existing call sites are tolerated only because nobody has rewritten them yet and will be converted as they are touched.** The library authors themselves [strongly advise against it](https://www.unistyl.es/v3/references/use-unistyles):

> We strongly recommend **not using** this hook, as it will re-render your component on every change. This hook was created to simplify the migration process and should only be used when other methods fail.

We have hit this gotcha repeatedly in Otto. The hook subscribes the component to **every** Unistyles runtime change (theme, breakpoint, insets, color scheme, scale) and returns a fresh object reference each call. That means a periodic lockstep re-render of warm subtrees (agent streams, panels, sidebars) even when nothing the user can see has changed - confirmed in profiling, with `theme` as the only changed input every cycle. It also breaks every downstream `useMemo`/`memo` boundary that includes a derived theme value.

Reviewers MUST reject PRs that introduce a new `useUnistyles()` call. There is no last-resort carveout. If you cannot solve a case with the alternatives below, file an issue and stop - do not paper over it with the hook.

Use these alternatives in order:

### 1. `StyleSheet.create((theme) => ...)` - default

Most theme-aware styling needs nothing else. The Babel plugin tracks theme dependencies inside the factory and updates the native ShadowTree without any React re-render.

```tsx
const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
  },
}));

<View style={styles.container} />;
```

If you are reading a theme value just to feed it back into a `style` prop, you almost certainly want this and not the hook.

### 2. Hard-coded constants for genuinely static values

If you only need a number that happens to live on the theme (e.g. a fixed spacing value used to compute a gap or animation distance), use a literal constant or import a static module. Static reads do not need a subscription. See the "Static Theme Imports" section below - importing `baseColors`, theme-name constants, or `type Theme` is fine when the value is intentionally static.

### 3. `withUnistyles(Component)` for third-party props

When a third-party component takes a non-`style` prop that must be theme-reactive (e.g. `BlurView.tint`, `Image.tintColor`, navigator option props, bottom-sheet `backgroundStyle`), wrap that single component with `withUnistyles`. Only the wrapper re-renders, not the surrounding tree.

```tsx
const ThemedBlur = withUnistyles(BlurView);
<ThemedBlur tint={theme.colors.surface0} />;
```

(Mind the `> *` child-selector leak documented further down.)

### 4. There is no "last resort"

There is no escape hatch. If none of (1)–(3) fit, the problem is upstream - fix it there or file an issue. The hook is not on the table.

## How Updates Propagate

For standard React Native components, the [Unistyles Babel plugin](https://www.unistyl.es/v3/other/babel-plugin) rewrites imports such as `View`, `Text`, `Pressable`, and `ScrollView` to Unistyles-aware component factories. On native, those factories borrow the component ref and register the `style` prop with the ShadowRegistry. The upstream ["Why my view doesn't update?"](https://www.unistyl.es/v3/guides/why-my-view-doesnt-update) guide describes this as the ShadowTree update path that avoids unnecessary React re-renders.

The important detail: the automatic native path tracks `props.style`. It does not generally track every prop that happens to carry style-like values.

### Do Not Materialize Styles At Module Scope

Never read a Unistyles style property into a module-level constant. This includes cached arrays:

```tsx
// Wrong: evaluated while the app may still be using the temporary system theme.
const ROW_STYLE = [settingsStyles.row, settingsStyles.rowBorder];

// Right: each style proxy is read when this view renders.
<View style={[settingsStyles.row, settingsStyles.rowBorder]} />;
```

Otto starts with adaptive themes, then applies the persisted theme after async settings load. A
module-level read can therefore materialize the light style before a persisted dark theme is
active. If the view mounts after that theme change, React Native receives the stale light object;
Unistyles registers the node for future changes but does not retroactively replace its initial
props. Settings dividers once rendered light `#e4e4e7` inside a dark `#252B2A` card for exactly
this reason.

Render-time array syntax is intentional and exempt from the app's JSX array-allocation lint rule.
Keep the entries separate so each retains its Unistyles metadata. If composition is needed outside
JSX, create the array inside the component or in a `useMemo` that first runs when the component
mounts-never at module evaluation time.

[`useUnistyles()`](https://www.unistyl.es/v3/references/use-unistyles) is different. It gives React access to the current theme/runtime and re-renders the component when those values change - which is exactly why it is banned (see the top of this page): it turns theme updates into React re-renders. For values that must travel through React props, such as icon colors, wrap the leaf in `withUnistyles` and pass a `uniProps` mapping instead; that is the pattern the codebase uses (`ThemedX` wrappers plus `(theme) => ({ color: ... })` mappings). Do not expect direct reads from `UnistylesRuntime` to re-render a component; [issue #817](https://github.com/jpudysz/react-native-unistyles/issues/817) is a useful reminder of that invariant.

### A Theme Shadow Silently Drops `shadowOpacity` On Web

Put the alpha inside `shadowColor` as an `rgba()` string. Never move it out to `shadowOpacity`, or the shadow paints at full strength.

When `shadowColor` comes from a theme token, Unistyles hoists it into a CSS variable so themes stay swappable at runtime, and composes only the geometry into the rule:

```css
.unistyles_pu55lmskkn {
  box-shadow: 0 3px 8px var(--shadow-md-shadow-color);
}
:root.light {
  --shadow-md-shadow-color: #000;
}
```

The variable carries the colour and nothing else. `shadowOpacity` never reaches the stylesheet, so `shadowColor: "#000"` with `shadowOpacity: 0.07` renders as **solid black**.

This failure is unusually convincing, so recognise it by shape rather than rediscovering it. Offset and blur edits land immediately, because the geometry does get composed into the class. Opacity edits appear to do nothing. The natural reading is "hot reload is stale" or "the value is not low enough yet", and both send you tuning a number the renderer is discarding. If geometry moves and alpha does not, stop and read the emitted CSS.

Styles built from literals rather than theme tokens do not take the variable path and compose `shadowOpacity` correctly, which is why a working example elsewhere in the app proves nothing. Compare the segmented control's `rgba(0, 0, 0, 0.08) 0px 1px 2px` against any theme-sourced popup.

Keep `shadowOpacity: 1` in the token for native. iOS multiplies it into the colour's own alpha (CALayer semantics), so `1` means "use the alpha in the string", while staying inert on web. Android ignores both and uses `elevation`.

To read what is actually rendering, attach to the dev desktop's CDP endpoint (see [development.md](development.md)) and dump the rules rather than reasoning about the pipeline:

```js
[...document.styleSheets]
  .flatMap((s) => [...s.cssRules])
  .filter((r) => r.cssText.includes("box-shadow"));
```

## Dynamic Pixel Styles On Web

Avoid feeding changing pixel values such as `{ top, left }`, `{ maxHeight }`, or `{ minWidth }` into the `style` prop of Unistyles-managed React Native components on web. The web runtime hashes each distinct style object by value and appends a CSS rule to `#unistyles-web`; those rules are not reclaimed during the page lifetime, so pointer-driven positioning can turn into steady stylesheet growth.

Use the inline style escape hatch below for high-churn values. Do not split a component into plain/web/native variants just to keep one measured value out of the CSS registry. Raw DOM wrappers are reserved for real DOM infrastructure, such as terminal hosts, virtualized web rows, or third-party drag wrappers.

## Inline Style Escape Hatch

When a style value is high-churn and must bypass Unistyles' CSS registry, keep the component on the normal Unistyles path and mark only that style object with `inlineUnistylesStyle`.

```tsx
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const styles = StyleSheet.create({
  thumb: {
    position: "absolute",
  },
});

<View style={[styles.thumb, inlineUnistylesStyle({ height, transform: [{ translateY }] })]} />;
```

This uses Unistyles' own animated-style lane: ordinary styles still become Unistyles classes, while the marked style object stays in React Native's inline style array. Use it for measured geometry, scroll or drag transforms, and pressed/hovered/open state where generating CSS classes is the wrong ownership boundary.

Do not split a component into plain and Unistyles variants just to handle one high-churn value. The component remains a normal Unistyles component; only the specific style object escapes.

When a reusable component has a prop whose whole job is dynamic geometry, make that prop the seam. For example, `FloatingSurface.frameStyle` and `FloatingScrollView.style` own their own escape hatch so menu, tooltip, hover-card, and combobox callers can stay declarative instead of knowing about Unistyles internals.

Do not flatten a caller-provided style array and pass the flattened object back to a React Native component. Unistyles style entries carry `unistyles_*` metadata; flattening two entries produces one object with multiple metadata keys and triggers the runtime warning: "use array syntax instead of object syntax." Preserve caller styles as arrays, and only flatten the dynamic geometry value you explicitly own. If that owned value was flattened from a mixed style prop, strip `unistyles_*` metadata before sending it through `inlineUnistylesStyle`.

Do not register an existing Unistyles style inside another `StyleSheet.create` either. That also combines two metadata identities into one object. Reuse the original style directly at the component:

```tsx
// Wrong: sharedStyles.row already carries Unistyles metadata.
const styles = StyleSheet.create({ row: sharedStyles.row });
<View style={styles.row} />;

// Right: one registered style identity reaches the native view.
<View style={sharedStyles.row} />;
```

This mistake once produced tens of thousands of warnings from retained sidebar rows. Because React Native captures component stacks for warnings, the warning loop itself can consume enough CPU and memory to make the app appear blank.

## Main Gotcha: `contentContainerStyle`

`ScrollView.contentContainerStyle` is the canonical trap. It looks like a style prop, but it is not the `style` prop Unistyles registers. How badly that bites depends on who owns the component:

- **A remapped React Native `ScrollView`** still picks the style up — the Babel plugin rewrites the import and the factory tracks `contentContainerStyle` alongside `style`. The failure mode here is staleness: on first mount it can paint with the theme that was active at mount time and never repaint. The upstream tutorial calls this out in its [ScrollView Background Issue](https://www.unistyl.es/v3/tutorial/settings-screen#scrollview-background-issue) section.
- **A third-party scroller** — `BottomSheetScrollView`, `FlashList`, anything Unistyles never rewrote — drops the style entirely on web. Nothing throws and the value looks right in JS, but the class Unistyles emitted is never applied, so the padding, gap, or background is simply absent. `AdaptiveModalSheet` shipped its compact sheet content flush to the screen edges for exactly this reason while the desktop card, which uses a real `ScrollView`, looked correct.

The second case is why the wrapper-`View` fix below is not optional styling advice. A themed inset belongs on a `View` you own; a third-party scroller only gets theme-free layout.

Avoid this pattern when the style depends on the theme:

```tsx
<ScrollView contentContainerStyle={styles.container} />;

const styles = StyleSheet.create((theme) => ({
  container: {
    flexGrow: 1,
    backgroundColor: theme.colors.surface0,
  },
}));
```

If app settings later load a persisted theme and call [`UnistylesRuntime.setTheme`](https://www.unistyl.es/v3/guides/theming#change-theme), the JS-side style proxy reports the new theme while the native content container keeps the old background. That is how the welcome screen ended up with a light background and dark foreground/buttons.

This applies broadly to non-`style` props that carry theme-dependent values, such as component props named `color`, `trackColor`, `tintColor`, `backgroundStyle`, `handleIndicatorStyle`, and other library-specific style props. The [3rd-party view decision algorithm](https://www.unistyl.es/v3/references/3rd-party-views) recommends explicit handling for these cases, and [issue #1030](https://github.com/jpudysz/react-native-unistyles/issues/1030) shows a related native-prop update edge case around `Image.tintColor`. Treat these values as React props unless wrapped with `withUnistyles`.

### On web, third-party components drop Unistyles styles entirely

Staleness is the mild version. On web it is worse: `StyleSheet.create` returns style objects whose style values are **non-enumerable** properties (see `removeInlineStyles` in `react-native-unistyles/src/web/utils/unistyle.ts`) - only Unistyles-tracked components can read them. Pass such a style to a component the Babel plugin does not remap (`@gorhom/bottom-sheet`'s `BottomSheetScrollView`, any third-party view) and spreading/flattening yields an empty object: **no styles apply at all, silently, from first paint**. Native is unaffected, so the symptom is web-only - which is how `AdaptiveModalSheet`'s bottom sheet shipped with its `contentContainerStyle` padding and the scroll view's `flexShrink` missing on web (content flush to the sheet edge, sticky footer pushed off-screen) while looking fine on device.

Fix pattern: give the third-party component only plain RN style objects (module-level `const`, theme-free), and put themed layout on a core `View` wrapped around the children - the wrapper-`View` pattern below. Grep candidates: any `style`/`contentContainerStyle` on a `BottomSheet*` component that references a Unistyles `styles.*` entry.

## Fix Patterns

Preferred pattern: put themed backgrounds on a normal wrapper view, and keep `contentContainerStyle` theme-free.

```tsx
<View style={styles.container}>
  <ScrollView contentContainerStyle={styles.contentContainer}>{children}</ScrollView>
</View>;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    flexGrow: 1,
    padding: theme.spacing[4],
  },
}));
```

This is the pattern used by the settings screen: the screen background lives on a normal `View style={styles.container}`, while the scroll content container only carries layout.

In practice the wrapper-`View` pattern is the one we use. Across the app, `withUnistyles` is now reserved for wrapping leaf components - mostly icons (`ThemedActivityIndicator`, `ThemedChevronDown`, …) and small third-party components like `MarkdownWithStableRenderer` - so they pick up theme-reactive `color`/`tintColor` props without re-rendering their parent.

In principle, [`withUnistyles`](https://www.unistyl.es/v3/references/with-unistyles) can also wrap a `ScrollView` to make `contentContainerStyle` theme-reactive via its [auto-mapping behavior for `style` and `contentContainerStyle`](https://www.unistyl.es/v3/references/with-unistyles#auto-mapping-for-style-and-contentcontainerstyle-props). We previously did this on the welcome screen and hit the `> *` child-selector leak documented below; we have since moved the welcome screen to the wrapper-`View` pattern. If you find yourself reaching for `withUnistyles(ScrollView)`, treat it as a smell and check whether a wrapper view works first.

Grandfathered files (the burn-down list in `.oxlintrc.json`) still contain the old escape hatch of calling `useUnistyles()` and passing an inline value through React. New code must not add it: it re-renders the component on every theme change and gives up the Unistyles native-update path for that value. Reach for the wrapper-`View` pattern above, or a `withUnistyles`-wrapped leaf with a `uniProps` mapping.

## `withUnistyles` And The `> *` Child-Selector Leak

`withUnistyles` on a component with a theme-dependent `style` prop works by wrapping the component in a `<div style={{display: 'contents'}} className={hash}>` and emitting the style under a `.hash > *` child selector so the styles cascade onto the wrapped component. This is how auto-mapping for `style` and `contentContainerStyle` works on web.

The sharp edge: Unistyles hashes styles by value. If `withUnistyles` receives a style whose value is **identical** to a style used elsewhere in the app on a plain `View`, both usages get the same hash - and both CSS rules (the element rule and the `> *` child rule) are emitted under the same class name. The `> *` rule then leaks onto the direct children of every `View` that shares the hash.

Concrete regression we hit: `welcome-screen.tsx` had `const ThemedScrollView = withUnistyles(ScrollView)` with `style={{ flex: 1, backgroundColor: theme.colors.surface0 }}`. `panels/agent-panel.tsx` had `root` and `container` styles with the exact same value. All three collided on class `unistyles_j2k2iilhfz`, so the browser stylesheet contained:

```css
.unistyles_j2k2iilhfz {
  flex: 1 1 0%;
  background-color: var(--colors-surface0);
}
.unistyles_j2k2iilhfz > * {
  flex: 1 1 0%;
  background-color: var(--colors-surface0);
}
```

The child-selector rule forced `flex:1` and `background-color: surface0` onto the Composer's outer `Animated.View` (a direct child of `container`), stretching it to fill remaining space and leaving a large empty gap between the composer UI and the bottom of the screen. It also painted a `surface0` band behind the scroll-to-bottom button. The bug only appeared in the browser - Electron skips `WelcomeScreen` after pairing, so the `> *` rule was never injected there.

Symptoms to watch for:

- A sibling of a themed panel-background `View` stretches unexpectedly on web only.
- Random direct children of a `{ flex: 1, backgroundColor: surface0 }` `View` pick up an unexpected background.
- DevTools shows a `.unistyles_xxx > *` rule you did not write.

Quick confirmation in DevTools console:

```js
[...document.styleSheets]
  .flatMap((s) => [...(s.cssRules || [])])
  .map((r) => r.cssText)
  .filter((t) => t.includes("unistyles") && t.includes("> *"));
```

Any match beyond benign `r-pointerEvents-* > *` rules from react-native-web is a leak.

Avoid the bug by preferring the wrapper-`View` pattern from the previous section whenever possible: put `{ flex: 1, backgroundColor: surface0 }` on a plain `View` and give the `ScrollView` a theme-free `style`/`contentContainerStyle`. That keeps `withUnistyles` off the hot path and avoids the hash collision. Only reach for `withUnistyles(ScrollView)` when a wrapper view is genuinely awkward, and when you do, give the wrapped style a distinctive shape (extra key, different layout) so it does not hash-collide with a common panel background used elsewhere.

## `pointerEvents` In Stylesheets Is Silently Broken On Web

Do not put `pointerEvents` inside a `StyleSheet.create` style (or any style object) - pass it as a **prop** on the `View`/`Animated.View`.

On web, Unistyles emits style properties as literal CSS, so `pointerEvents: "box-none"` becomes `pointer-events: box-none` - not a valid CSS value. The browser drops the declaration and the element silently keeps `pointer-events: auto`. Nothing errors, nothing warns; the overlay just eats clicks. The `pointerEvents` **prop** goes through react-native-web instead, which maps `box-none`/`box-only` to real CSS classes (the benign `r-pointerEvents-* > *` rules mentioned above).

Concrete regression we hit: the agent stream's scroll-to-bottom overlay - a full-width absolute strip with `pointerEvents: "box-none"` in its Unistyles stylesheet. On web the strip blocked clicks on action groups to the left and right of the button. Moving `box-none` to the prop fixed it.

Second sharp edge once you use the prop: RNW's `box-none` implementation resets **direct children** to `pointer-events: auto`. If a full-width layout wrapper sits between the `box-none` container and the interactive element, that wrapper becomes clickable again and blocks the same area. The interactive element must be the direct child of the `box-none` view - don't sandwich a centering wrapper in between.

## Hidden Sheet Content

`@gorhom/bottom-sheet` can keep `BottomSheetModal` content mounted while the sheet is hidden. That matters during Otto's startup theme transition: a header node can be created under the initial adaptive theme, stay hidden, then appear later with stale native style values even though surrounding content has re-rendered correctly.

We saw this in `AdaptiveModalSheet`: the body text and buttons were dark-theme-correct, but the shared sheet title opened with the initial light-theme text color on a dark sheet background. For tiny values in a reusable sheet header, route the stale theme-dependent value through React with a `withUnistyles`-wrapped leaf and a `uniProps` mapping (grandfathered files do this with the banned `useUnistyles()` hook; do not copy that form into new code). Keep layout and typography in `StyleSheet.create`; move only the stale theme-dependent value through React. If a larger subtree shows the same behavior, consider remounting the sheet on theme changes or moving the themed paint onto a wrapper that is mounted with the visible content.

The same rule applies to bottom-sheet component props such as `backgroundStyle` and `handleIndicatorStyle`: they are library props, not the direct React Native `style` prop Unistyles registers. Prefer a custom `backgroundComponent` wrapped in `withUnistyles`, mapping the themed values through `uniProps`.

## Memoized Style Objects

When a third-party library receives a plain style object, it is outside Unistyles' native tracking path. Make sure any memo that builds that style object depends on the actual theme values it reads. (The examples below use `useUnistyles()` because they document existing grandfathered call sites; the dependency rule is what matters, and it applies wherever the theme object comes from.)

Avoid indirect keys like this:

```tsx
const { theme, rt } = useUnistyles();
const markdownStyles = useMemo(() => createMarkdownStyles(theme), [rt.themeName]);
```

On adaptive system-theme changes, the hook can provide a light/dark theme update while an indirect runtime key is not the value that invalidates the memo. That leaves the library rendering stale colors. Assistant markdown hit this exact failure: the workspace shell switched to light, but assistant text and code spans kept the old dark-theme markdown style object.

Prefer the hook theme itself, or explicit theme tokens, as the dependency:

```tsx
const { theme } = useUnistyles();
const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
```

If a style factory is cheap, skipping `useMemo` entirely is also fine.

## Static Theme Imports

Do not import `theme` from `@/styles/theme` for live UI colors. That export is a dark-theme compatibility default, so using it in render code leaves icons, placeholders, or third-party props pinned to dark colors in light mode.

Wrap the icon (or other leaf component) with `withUnistyles` instead, so only that node re-renders when the theme changes:

```tsx
import { ChevronDown } from "@/components/icons/material-icons";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

const ThemedChevronDown = withUnistyles(ChevronDown);

const styles = StyleSheet.create((theme) => ({
  icon: { color: theme.colors.foregroundMuted },
}));

<ThemedChevronDown size={theme.iconSize.md} style={styles.icon} />;
```

This is the dominant pattern in the app today (see `sidebar-workspace-list.tsx`, `message.tsx`, the workspace screens). Reserve `useUnistyles()` for the last-resort cases described at the top of this file. Importing `baseColors`, theme-name constants, or `type Theme` is fine when the value is intentionally static or type-only.

## Reanimated `Animated.View` + Dynamic Styles Crashes

Do not apply `StyleSheet.create((theme) => ...)` styles to a Reanimated `Animated.View`. Unistyles wraps styled components in a `<UnistylesComponent>` and patches native view props from C++ via the ShadowRegistry. Reanimated also reaches into the same native node from its worklet runtime. When a theme change fires, both systems try to mutate the same node and the app crashes with `Unable to find node on an unmounted component.` This was a real iOS sidebar crash on theme toggle (commit `4896cfe9`).

Fix: keep static positioning on the `Animated.View` in plain React Native `StyleSheet`, and pass theme-dependent values (e.g. `backgroundColor`) as inline style from `useUnistyles()` - the inline path is acceptable here because no other escape works:

```tsx
import { StyleSheet as RNStyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { useUnistyles } from "react-native-unistyles";

const positionStyles = RNStyleSheet.create({
  sidebar: { position: "absolute", inset: 0, width: 280 },
});

function Sidebar() {
  const { theme } = useUnistyles();
  return (
    <Animated.View
      style={[positionStyles.sidebar, animatedStyle, { backgroundColor: theme.colors.surface1 }]}
    />
  );
}
```

This is one of the rare places `useUnistyles()` is the right tool: there is no `withUnistyles(Animated.View)` equivalent, the affected component is small, and the alternative is a crash.

## Adaptive Themes And Persisted Settings

Unistyles [`initialTheme`](https://www.unistyl.es/v3/guides/theming#select-theme) and [`adaptiveThemes`](https://www.unistyl.es/v3/guides/theming#adaptive-themes) are mutually exclusive. `initialTheme` can be a string or a synchronous function, but it cannot wait on async storage.

Otto currently stores app settings in AsyncStorage and loads them through react-query. That means the app can mount under adaptive/system theme first, then switch after settings load:

1. Unistyles config starts with `adaptiveThemes: true`.
2. The device may report system light.
3. Settings load a persisted non-auto preference, such as dark.
4. The app calls `setAdaptiveThemes(false)` and `setTheme("dark")`.

That brief transition is expected with the current storage model. It makes tracking-compatible styles important: anything mounted during the initial adaptive theme must update correctly after the persisted preference applies. [Issue #550](https://github.com/jpudysz/react-native-unistyles/issues/550) was a separate ScrollView sticky-header bug, but it is still useful context for why ScrollView theme updates deserve extra suspicion.

If we ever need to avoid the transition entirely, store at least the theme preference in synchronous storage and configure Unistyles with `initialTheme`.

## Runtime Theme Patching For User Preferences

Appearance settings (UI/mono font family, font sizes, syntax-highlight theme) are applied by patching every registered theme at runtime with `UnistylesRuntime.updateTheme(name, updater)` - not by threading preference reads through components. `applyAppearance` in `packages/app/src/screens/settings/appearance/apply-appearance.ts` runs from a `ProvidersWrapper` effect on settings load/change and loops `ALL_THEME_KEYS`, returning `{ ...theme, fontFamily, fontSize, lineHeight, colors.syntax }`.
Appearance settings (theme, UI/mono font family, font sizes, syntax-highlight theme) are owned by `packages/app/src/appearance`. Its provider subscribes once and synchronizes Unistyles when settings or plugin contributions change. `applyAppearance` patches every key in `REGISTERED_THEMES`, returning `{ ...theme, fontFamily, fontSize, lineHeight, colors.syntax }`.

This works without `useUnistyles()` because every consumer already reads these tokens through `StyleSheet.create((theme) => …)` (or the `withUnistyles`/`uniProps` path for the markdown renderer), so patching the theme repaints tracked views through the native ShadowRegistry with no React re-render.

### Only two registered theme keys: `light`/`dark` as repaintable mirrors

Only two Unistyles theme keys are ever registered (`packages/app/src/styles/unistyles.ts`'s `StyleSheet.configure({ themes: { light, dark } })`) - not one key per named variant (Meadow, Ember, Slate, ...). This is a hard constraint, not a style choice: `schemeToTheme()` inside `react-native-unistyles` hardcodes the literal strings `'light'`/`'dark'`, and `UnistylesRuntime.setAdaptiveThemes(true)` always resolves to `setTheme(schemeToTheme(colorScheme))` - adaptive mode can only ever toggle between whatever is registered under those two literal keys, never an arbitrary named theme.

Otto's appearance settings let a user pick a specific variant per spectrum (e.g. Meadow for light, Ember for dark) and have System mode auto-swap between those two specific picks as the OS scheme flips. The only way to make that work is to keep the `light`/`dark` keys perpetually repainted with `colors`/`shadow` copied from whichever variant is the user's current pick - `packages/app/src/screens/settings/appearance/apply-color-scheme.ts`'s `applyColorScheme` does this, sourcing from the 15 named variant objects in `theme.ts` (`meadowTheme`, `darkGhosttyTheme`, etc.), which are exported as plain data and never passed to `StyleSheet.configure` themselves. This repaint runs regardless of which mode is active (explicit Light/Dark or System), so switching modes back and forth never loses or resets a per-spectrum pick, and there's no staleness window - do not "simplify" this by re-registering variant keys individually; it would break System mode's ability to target an arbitrary variant.

**Always repaint before switching adaptive/pinned state, never after** - `applyColorScheme` repaints both mirrors first, then calls `setAdaptiveThemes`/`setTheme`, so there is no frame where a mirror still shows a stale variant.

Gotchas:

- **Patch all registered themes, not just the active one.** The active theme can change and adaptive mode can flip light/dark; patching every key keeps the active key current and makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant. The effect depends on the settings values (not on the resolved theme), so it cannot loop.
- **Narrow the discriminated union before spreading.** `updateTheme`'s updater returns the theme union; spreading the union widens `colorScheme` to `"light" | "dark"`, which is assignable to neither concrete member. Branch on `t.colorScheme` so each branch spreads a single narrowed theme type (no `as`). Both `applyAppearance` and `applyColorScheme` need this.
- **`colors.syntax` is owned by `applyAppearance`, not `applyColorScheme`.** When repainting `colors` from a variant's source palette, carry the mirror's _existing_ `colors.syntax` forward (`{ ...source.colors, syntax: t.colors.syntax }`) instead of the source variant's own syntax value, so the two patchers stay commutative regardless of call order.
- **`lineHeight.diff` is the code/diff line-height axis** - it is coupled to the code-font-size control (≈ `codeFontSize * 1.5`). Do NOT use it for prose. Markdown body line-height scales with the UI ramp (`Math.round(theme.fontSize.base * 1.4)`); routing prose through `lineHeight.diff` clips text at small code sizes.
- **Patch all themes, not just the active one.** The active theme can change and adaptive mode can flip light/dark; patching every key keeps the active key current and makes ordering vs `setTheme`/`setAdaptiveThemes` irrelevant. The effect depends on the settings values (not on `theme`), so it cannot loop.
- **The reserved plugin keys are the exception to that ordering.** A plugin-contributed theme is rebuilt from its palette, which discards the appearance patch, so the appearance provider writes the matching light or dark slot before applying font and syntax preferences. See [plugins.md](plugins.md).
- **Narrow the discriminated union before spreading.** `updateTheme`'s updater returns the theme union; spreading the union widens `colorScheme` to `"light" | "dark"`, which is assignable to neither concrete member. Branch on `t.colorScheme` so each branch spreads a single narrowed theme type (no `as`).
- **`lineHeight.diff` is the code/diff line-height axis** — it is coupled to the code-font-size control (≈ `codeFontSize * 1.5`). Do NOT use it for prose. Markdown body line-height scales with content size (`Math.round(theme.fontSize.content * 1.4)`); routing prose through `lineHeight.diff` clips text at small code sizes.
- **High-churn draft values** (live-while-typing in the appearance preview) bypass the theme: apply them as inline styles marked with `inlineUnistylesStyle` so per-keystroke values don't grow the `#unistyles-web` CSS registry.
- **The app shell uses one `AppearanceStyleBoundary`.** Runtime-patched numeric theme values are baked into Unistyles web classes rather than CSS variables, while parsed/memoized content also does not naturally re-run when appearance tokens change. The boundary sits below stable runtime providers in `app/_layout.tsx` and remounts the visual shell once. `applyAppearance` patches the active theme before inactive registry entries so its subscribers receive the committed values in the same update. Do not add local appearance keys or nested boundaries.
- **Dynamic font tokens stay widened.** `fontFamily`, `fontSize`, and `lineHeight` on `commonTheme` are annotated `string`/`number` (not narrowed by `as const`) so the updater's return assigns; the platform default stacks live in `DEFAULT_UI_FONT_STACK` / `DEFAULT_MONO_FONT_STACK`.

## `ScopedTheme` Does Not Own A Long-Lived Chat Canvas

`ScopedTheme` (used by the "Black agent chat background" setting - Settings > Appearance > Agents - to force the `black` theme inside chat panes) works by setting a registry-level "scoped theme" flag during the renders that pass through its marker children. Styles registered in that window are computed against the scoped theme. That marker model is not a persistent descendant context. On web, a deep child re-render can recompute its class without a scope. On native, an Android retained view can detach and reattach, or a stream child can mount from a deep store update, without registering its canvas through the marker pair. In either case, `ScopedTheme` alone is not authoritative enough for the pane background.

The pure-black canvas therefore has an explicit owner. `components/black-chat-scope-context.tsx` publishes the setting through React context and exports a core React Native `#000000` style. Every opaque chat canvas (agent panel, stream, draft, and communications room) reapplies that style whenever it renders. `ScopedTheme` remains responsible for the richer dark palette inside the canvas. Do not replace the explicit canvas with a remount key: retained tabs exist to preserve expensive transcript state, and remounting on every tab switch defeats that contract.

`resolveBlackChatCanvasStyle` covers the pure-black fills, but a chat pane is more than its canvas: the composer's input well, queue rows and control chips are elevated surfaces that must come from the black variant's own ramp, and the seam fades must reach the same `#000000`. Those still went through `ScopedTheme`, so they unwound exactly as above - the composer re-renders on every keystroke, the queue on every added message, and neither pass runs between the pane-level markers. On Android that showed as a slate composer band and slate seam gradients sitting on a pure-black transcript.

`components/chat-theme-scope.tsx` (`ChatThemeScope`) is the answer to that half. It re-asserts `ScopedTheme name="black"` **inside** a component's own returned tree, so the markers are part of that component's output and run again on each of its re-renders, re-binding everything it renders. Rules for it:

- Wrap a component's own JSX, never wrap the component from its parent - a parent wrap has exactly the bug it is meant to fix.
- Use it on components that re-render independently and own visible chrome. It is applied to `Composer`, to the agent panel's composer column, and across the native transcript (see below).
- The native transcript needs it per row, and that supersedes the earlier "never wrap the message list" rule. `strategy-native.tsx` renders history through a `FlatList` whose cells mount from the list's own render passes, and the live turn through an external store read by `LiveStreamHeader` - neither ever passes between the pane-level `BlackChatScope` markers, so with the setting on the entire Android transcript painted in the app palette (light bubbles, light code chips, dark prose) on a pure-black canvas. `renderItem` and `LiveStreamHeader` therefore wrap their own output, and `UserMessage`, `AssistantMessage` and `ExpandableBadge` wrap theirs so their own state-driven re-renders (playback, press, measured multi-line summaries) stay bound.
- `AgentStreamView` wraps its own returned tree for the same reason. It owns the pane chrome that is not a list row - the scroll-to-bottom button, the outline rail, the seam fades, the empty state - and re-renders on its own state (`isNearBottom`, detachment), so none of those renders reach the pane-level markers either.
- A wrap does not save an eager read. `color={stylesheet.someIcon.color}` in a render body resolves against the theme that is active _before_ the markers in the returned tree run, so it keeps the app palette however the tree is scoped. Take the value through `withUnistyles` + `uniProps` instead, so the mapping runs during the icon's own render. The scroll-to-bottom chevron was doing exactly this.
- The cost of that is real and bounded: `NamedTheme` calls `UnistylesShadowRegistry.flush()` from a `useLayoutEffect` on every render, so each wrap adds a native flush on the streaming hot path. `ChatThemeScope` returns its children untouched when the Black tab background setting is off, so only users of that setting pay it. Do not add wraps that are not needed to keep a surface bound.
- It is a no-op file on web (`chat-theme-scope.web.tsx`): the descendant CSS-variable class already survives re-renders there.
- `ChatSeamFade` does not use it - its color is resolved through `withUnistyles`, so it reads the canvas constant directly when the scope is on.

The web fix relies on how Unistyles themes work there: with the default `CSSVars` mode, every generated class references `var(--...)` and each registered theme's variables are emitted under `:root.<name>` in the `#unistyles-web` style tag. `components/black-chat-scope.web.tsx` wraps the pane in a `display: contents` DOM element carrying `.otto-black-chat-scope`, and `styles/black-chat-scope.ts` mirrors the generated `:root.black{...}` block verbatim under that class (re-synced by `applyColorScheme`/`applyAppearance` after every repaint). CSS cascading then wins regardless of re-renders. Copying the generated rule - instead of serializing the theme ourselves - guarantees the variable names match whatever the installed Unistyles version emits.

The web `BlackChatScope` deliberately does not use `ScopedTheme`; it relies on the descendant CSS-variable class. `withUnistyles`/`uniProps` consumers resolve concrete values through React rather than CSS variables, so icon color props can still use the app palette when they mount during a partial render. That is usually a muted-grey difference, while the canvas and every `StyleSheet.create` color remain correctly scoped.

The fix for JS-resolved _color_ values on web is `styles/theme-color-ref.ts` (`themeColorRef(theme, "surface2")`): it emits `var(--colors-surface2)` on web so the value follows the nearest ancestor's CSS variables (the black scope wrapper inside chat panes, `:root` elsewhere), and the concrete theme value on native where `ScopedTheme` works. `styles/markdown-styles.ts` uses it for every color. Restrictions: only flat color tokens, only values that reach the DOM as CSS, never do math on the result - and **not** for `react-native-svg` icon `color` props, which land as an SVG presentation attribute where `var()` does not resolve. Icon `uniProps` color mappings inside scoped subtrees still have the mount-timing leak (muted greys, low visual impact); fixing them needs a different route (e.g. `style: { color: var }` instead of the `color` prop).

If you scope another subtree to a named theme on web, reuse `BlackChatScope`'s pattern; do not reach for `ScopedTheme` alone.

## Patched: `uniProps` leaked to the DOM on web

Upstream `withUnistyles` (v3.2.4) merges the wrapper's full props - including the `uniProps` function itself - into the props spread onto the wrapped component. On web that forwards `uniProps` all the way to a DOM element, and React logs ``React does not recognize the `uniProps` prop on a DOM element`` for every `uniProps` callsite on screen. Harmless on native (RN drops unknown props) but it floods the web console - including the console channel browser-based verification tooling reads.

Fixed by `patches/react-native-unistyles+3.2.4.patch` (applied via `scripts/postinstall-patches.mjs`), which strips `uniProps` from the pass-through props in the web `withUnistyles` before merging. When bumping the unistyles version, re-check whether upstream fixed this; if not, re-create the patch (`npx patch-package react-native-unistyles`) and update the filename in `patches/`.

## Debugging

To inspect what the Babel plugin sees, temporarily enable [`debug: true`](https://www.unistyl.es/v3/other/babel-plugin#debug) in `packages/app/babel.config.js`:

```js
[
  "react-native-unistyles/plugin",
  {
    root: "src",
    debug: true,
  },
],
```

Then rebuild the bundle and look for lines such as:

```text
src/components/welcome-screen.tsx: styles.container: [Theme]
```

This only confirms that the stylesheet dependency was detected. The upstream debugging guide makes the same distinction: dependency detection is only one failure mode. It does not prove the style prop is registered on the native view you care about.

For paint-layer bugs, use high-contrast probes:

1. Paint each candidate layer a distinct color, such as root wrapper cyan, `ScrollView.style` yellow, and `contentContainerStyle` magenta.
2. Cold-restart the app, not just Fast Refresh.
3. Screenshot the simulator and sample pixels to see which color fills the area.
4. Remove the probes before committing.

The welcome-screen investigation used this approach to prove the white layer was the `ScrollView` content container.

## References

- [Unistyles v3 documentation](https://www.unistyl.es/)
- [Theming: initial theme, adaptive themes, and runtime theme changes](https://www.unistyl.es/v3/guides/theming)
- [ScrollView Background Issue](https://www.unistyl.es/v3/tutorial/settings-screen#scrollview-background-issue)
- [withUnistyles reference](https://www.unistyl.es/v3/references/with-unistyles)
- [3rd-party view decision algorithm](https://www.unistyl.es/v3/references/3rd-party-views)
- [Babel plugin debug option](https://www.unistyl.es/v3/other/babel-plugin#debug)
- [Why my view doesn't update?](https://www.unistyl.es/v3/guides/why-my-view-doesnt-update)
- [GitHub issue #550: ScrollView sticky-header theme updates](https://github.com/jpudysz/react-native-unistyles/issues/550)
- [GitHub issue #817: `UnistylesRuntime.themeName` does not re-render](https://github.com/jpudysz/react-native-unistyles/issues/817)
- [GitHub issue #1030: `Image.tintColor` and native style update edge case](https://github.com/jpudysz/react-native-unistyles/issues/1030)
