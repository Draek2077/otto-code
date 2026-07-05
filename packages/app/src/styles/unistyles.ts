import { StyleSheet } from "react-native-unistyles";
import {
  lightTheme,
  daylightTheme,
  pastelTheme,
  darkTheme,
  darkEvergreenTheme,
  darkZincTheme,
  darkMidnightTheme,
  darkClaudeTheme,
  darkGhosttyTheme,
  darkCyberpunkTheme,
} from "./theme";

StyleSheet.configure({
  themes: {
    light: lightTheme,
    daylight: daylightTheme,
    pastel: pastelTheme,
    dark: darkTheme,
    darkEvergreen: darkEvergreenTheme,
    darkZinc: darkZincTheme,
    darkMidnight: darkMidnightTheme,
    darkClaude: darkClaudeTheme,
    darkGhostty: darkGhosttyTheme,
    darkCyberpunk: darkCyberpunkTheme,
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
  light: typeof lightTheme;
  daylight: typeof daylightTheme;
  pastel: typeof pastelTheme;
  dark: typeof darkTheme;
  darkEvergreen: typeof darkEvergreenTheme;
  darkZinc: typeof darkZincTheme;
  darkMidnight: typeof darkMidnightTheme;
  darkClaude: typeof darkClaudeTheme;
  darkGhostty: typeof darkGhosttyTheme;
  darkCyberpunk: typeof darkCyberpunkTheme;
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
