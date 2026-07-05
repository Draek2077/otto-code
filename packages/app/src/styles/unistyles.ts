import { StyleSheet } from "react-native-unistyles";
import { daylightTheme, darkTheme } from "./theme";

// Only two Unistyles theme keys are ever registered — `light`/`dark`. Every
// other named variant (Meadow, Ember, Slate, ...) lives in `theme.ts` as
// plain data, copied into these two keys at runtime by
// `screens/settings/appearance/apply-color-scheme.ts`. See that file for why:
// Unistyles' adaptive-theme mechanism hardcodes switching between the
// literal keys `light`/`dark` and cannot target an arbitrary named theme.
// Seed content here is today's default pair (Daylight/Twilight).
StyleSheet.configure({
  themes: {
    light: daylightTheme,
    dark: darkTheme,
  },
  breakpoints: {
    xs: 0,
    sm: 576,
    md: 768,
    lg: 992,
    xl: 1200,
  },
  settings: {
    adaptiveThemes: true,
  },
});

// Type augmentation for TypeScript
interface AppThemes {
  light: typeof daylightTheme;
  dark: typeof darkTheme;
}

interface AppBreakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}
