import { baseColors, daylightColors, lightShadow } from "@/styles/theme-palettes";

// Colors come from the real light palette. `theme-palettes.ts` has no imports at
// all, so pulling it in here cannot cycle back through this stub - which is
// exactly why the theme itself (`@/styles/theme`) is not imported: it reaches
// `@/constants/layout`, which imports `react-native-unistyles`, i.e. this file.
//
// The scale ladders below are the one part that has to be restated. Keeping them
// as a hand-written literal is how this stub went stale before: a component read
// `theme.iconSize.chromeMd`, the literal had no `iconSize` at all, and the
// failure surfaced as "Cannot read properties of undefined (reading 'md')"
// inside a test that had nothing to do with icons. So every scale is served
// through `numericScale`, which answers any key - a ladder gaining a step is not
// a reason for an unrelated test to fail. Tests that assert on a specific token
// should assert against the real theme (`src/styles/theme.test.ts`), not here.
function numericScale(
  fallback: number,
  known: Record<string, number> = {},
): Record<string, number> {
  return new Proxy(known, {
    get: (target, key) =>
      typeof key === "string" && key in target ? target[key] : (fallback as unknown),
  }) as Record<string, number>;
}

const testTheme = {
  colorScheme: "light",
  colors: {
    ...daylightColors,
    palette: baseColors,
    // Syntax colors live in the @otto-code/highlight workspace package. Nothing
    // under test asserts on them, and reaching for a built workspace dependency
    // from a stub is how test setup starts needing a build step.
    syntax: new Proxy({}, { get: () => "#000000" }) as Record<string, string>,
  },
  shadow: lightShadow,
  spacing: numericScale(8, { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 28, 8: 32 }),
  fontSize: numericScale(14),
  fontFamily: { ui: "System", mono: "monospace" },
  lineHeight: numericScale(20),
  iconSize: numericScale(16),
  fontWeight: { normal: "400", medium: "500", semibold: "600", bold: "700" },
  borderRadius: numericScale(6, { none: 0, sm: 2, base: 4, md: 6, lg: 8, xl: 12, full: 9999 }),
  borderWidth: numericScale(1, { none: 0, hairline: 1, thin: 1, base: 1, thick: 2 }),
  opacity: numericScale(1, { disabled: 0.5, muted: 0.6, subtle: 0.8, full: 1 }),
  layout: { chatMaxWidth: undefined as number | undefined },
};

type StyleFactory<T> = (theme: typeof testTheme) => T;

function isStyleFactory<T>(styles: T | StyleFactory<T>): styles is StyleFactory<T> {
  return typeof styles === "function";
}

export const StyleSheet = {
  create: <T>(styles: T | StyleFactory<T>): T =>
    isStyleFactory(styles) ? styles(testTheme) : styles,
};

export const withUnistyles = <T>(Component: T): T => Component;

export const useUnistyles = () => ({
  theme: testTheme,
  rt: {},
  breakpoint: undefined,
});

export const UnistylesRuntime = {
  setTheme: () => undefined,
  themeName: "light",
};
