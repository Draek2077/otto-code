import { StyleSheet } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

/**
 * Tone system for tinted chrome — fly-out bands, banners, callouts, any surface
 * that carries a color.
 *
 * Tones are named by COLOR, not by meaning, because that is how they get asked
 * for: "make that fly-up blue". Each one resolves to the theme's status token of
 * that hue, so every theme — all six light, all seven dark, and the black scopes
 * over them — supplies its own calibrated value.
 *
 * The rule this encodes: a tinted surface is a theme token passed STRAIGHT
 * THROUGH, never a color computed from one. `theme.colors.*` is a real value in
 * React but not inside `StyleSheet.create`, so anything that parses it there
 * (`hexColorWithAlpha` and friends) silently returns undefined and the surface
 * falls back to its base — a bug that reads as "the tint does nothing" no matter
 * what alpha you pick. One token in, one token out.
 *
 * Adding a color means adding its `status*Surface` token in `theme.ts` and one
 * row here. Callers never write a hex.
 */
export type FlyoutTone = "orange" | "red" | "blue" | "green" | "purple";

export const FLYOUT_TONES: readonly FlyoutTone[] = [
  "orange",
  "red",
  "blue",
  "green",
  "purple",
] as const;

/**
 * Fill + border per tone. Compose with the caller's own geometry:
 * `style={[styles.band, toneStyles[toneSurface(tone)]]}`.
 */
export const toneStyles = StyleSheet.create((theme) => ({
  orangeSurface: {
    backgroundColor: theme.colors.statusWarningSurface,
    borderColor: theme.colors.statusWarning,
  },
  redSurface: {
    backgroundColor: theme.colors.statusDangerSurface,
    borderColor: theme.colors.statusDanger,
  },
  blueSurface: {
    backgroundColor: theme.colors.statusInfoSurface,
    borderColor: theme.colors.statusInfo,
  },
  greenSurface: {
    backgroundColor: theme.colors.statusSuccessSurface,
    borderColor: theme.colors.statusSuccess,
  },
  purpleSurface: {
    backgroundColor: theme.colors.statusMergedSurface,
    borderColor: theme.colors.statusMerged,
  },
  orangeText: { color: theme.colors.statusWarning },
  redText: { color: theme.colors.statusDanger },
  blueText: { color: theme.colors.statusInfo },
  greenText: { color: theme.colors.statusSuccess },
  purpleText: { color: theme.colors.statusMerged },
}));

export function toneSurface(tone: FlyoutTone) {
  return `${tone}Surface` as const;
}

export function toneText(tone: FlyoutTone) {
  return `${tone}Text` as const;
}

/**
 * Icon tint per tone, as a `withUnistyles` mapping. Icons take `color` as a
 * React prop, so they cannot read the token from a stylesheet — wrapping the
 * icon and handing it this mapping is the sanctioned way to keep it
 * theme-reactive (see docs/unistyles.md).
 */
const TONE_ICON_TOKEN = {
  orange: "statusWarning",
  red: "statusDanger",
  blue: "statusInfo",
  green: "statusSuccess",
  purple: "statusMerged",
} as const satisfies Record<FlyoutTone, keyof Theme["colors"]>;

export function toneIconColor(tone: FlyoutTone) {
  return (theme: Theme) => ({ color: theme.colors[TONE_ICON_TOKEN[tone]] });
}
