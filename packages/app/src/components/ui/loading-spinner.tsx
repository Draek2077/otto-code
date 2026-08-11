import React from "react";
import { ActivityIndicator, type ActivityIndicatorProps } from "react-native";
import { withUnistyles } from "react-native-unistyles";

type LoadingSpinnerProps = Omit<ActivityIndicatorProps, "color"> & {
  /** @deprecated Loading spinners always use the active theme accent. */
  color?: ActivityIndicatorProps["color"];
  size?: ActivityIndicatorProps["size"];
};

const AccentActivityIndicator = withUnistyles(ActivityIndicator);
const accentColorMapping = (theme: { colors: { accent: string } }) => ({
  color: theme.colors.accent,
});

export function LoadingSpinner({ color: _color, size = "small", ...props }: LoadingSpinnerProps) {
  return <AccentActivityIndicator size={size} uniProps={accentColorMapping} {...props} />;
}
