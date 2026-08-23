import React from "react";
import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import {
  ICON_SIZE_TOKENS,
  isIconSizeToken,
  type IconSizeToken,
} from "@/components/icons/icon-size";
import type { Theme } from "@/styles/theme";

type LoadingSpinnerProps = Omit<ActivityIndicatorProps, "color" | "size"> & {
  /** @deprecated Loading spinners always use the active theme accent. */
  color?: ActivityIndicatorProps["color"];
  /**
   * React Native's own `"small" | "large" | number`, or an icon size token.
   *
   * A spinner most often stands in for an icon while something loads - a refresh
   * button, a model picker's leading glyph - and it has to be the size of the icon it
   * replaces or the row twitches when the load finishes.
   */
  size?: ActivityIndicatorProps["size"] | IconSizeToken;
};

const AccentActivityIndicator = withUnistyles(ActivityIndicator);
const accentColorMapping = (theme: { colors: { accent: string } }) => ({
  color: theme.colors.accent,
});

// One mapping per token, built once: the accent this component always wears, plus the
// token's size. Composed here rather than by wrapping twice, because the accent mapping
// and the size mapping would otherwise both want to be `uniProps`.
const accentSizeMappings = Object.fromEntries(
  ICON_SIZE_TOKENS.map((token) => [
    token,
    (theme: Theme) => ({ color: theme.colors.accent, size: theme.iconSize[token] }),
  ]),
) as Record<IconSizeToken, (theme: Theme) => { color: string; size: number }>;

export function LoadingSpinner({ color: _color, size = "small", ...props }: LoadingSpinnerProps) {
  if (isIconSizeToken(size)) {
    return <AccentActivityIndicator uniProps={accentSizeMappings[size]} {...props} />;
  }
  return <AccentActivityIndicator size={size} uniProps={accentColorMapping} {...props} />;
}
