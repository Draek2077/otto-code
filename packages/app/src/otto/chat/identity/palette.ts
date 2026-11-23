export interface SpinnerColors {
  glowA: string;
  glowB: string;
}
/** Released semantic blue, projected because Paseo has no statusInfo token. */
export function workspaceActivityBlue(dark: boolean): string {
  return dark ? "#38bdf8" : "#0284c7";
}
// Released 0.9.35 glow pairs, projected without changing Paseo themes.
const PAIRS: Record<string, SpinnerColors> = {
  light: {
    glowA: "#c69700",
    glowB: "#0d8ede",
  },
  dark: {
    glowA: "#79b3f2",
    glowB: "#f591b5",
  },
  darkZinc: {
    glowA: "#f5f6fa",
    glowB: "#4fd8ee",
  },
  darkMidnight: {
    glowA: "#7fb3ff",
    glowB: "#b79cff",
  },
  darkClaude: {
    glowA: "#ff9866",
    glowB: "#ffd07e",
  },
  darkGhostty: {
    glowA: "#6ba6ff",
    glowB: "#cba6f7",
  },
  darkPureBlack: {
    glowA: "#7ccba0",
    glowB: "#20744A",
  },
};
export function chatSpinnerColors(themeName: string | undefined): SpinnerColors {
  return PAIRS[themeName ?? "dark"] ?? PAIRS.dark!;
}
