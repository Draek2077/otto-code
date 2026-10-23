import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ActivityIndicatorProps, ImageStyle, TextStyle, ViewStyle } from "react-native";
import type { Theme } from "@/styles/theme";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { BrainPalette } from "../input";
import { useBrainSurfaceActive } from "../lifecycle";
interface BrainScreenThemeExtension {
  fontSize: { xs: number };
  colors: BrainPalette & {
    accentBright: string;
    surfaceHover: string;
    surfaceCode: string;
    surfaceControlTrack: string;
    surfaceInteractiveSelected: string;
    surfaceInteractiveHover: string;
    surfaceInteractivePressed: string;
  };
}
// Keep Theme's light/dark discriminant intact for current shared control geometry.
export type BrainScreenTheme = Theme & BrainScreenThemeExtension;
const ThemeContext = createContext<BrainScreenTheme | null>(null);
export function BrainScreenThemeProvider({
  theme,
  children,
}: {
  theme: BrainScreenTheme;
  children: ReactNode;
}) {
  return <ThemeContext value={theme}>{children}</ThemeContext>;
}
export function useBrainScreenTheme(): BrainScreenTheme {
  const theme = useContext(ThemeContext);
  if (!theme)
    throw new Error("BrainScreenThemeProvider is required for Brain operational surfaces.");
  return theme;
}
export function BrainLoadingSpinner({
  size,
  style,
}: {
  size?: ActivityIndicatorProps["size"];
  style?: ActivityIndicatorProps["style"];
}) {
  const theme = useBrainScreenTheme();
  const active = useBrainSurfaceActive();
  if (!active) return null;
  return <LoadingSpinner color={theme.colors.accent} size={size} style={style} />;
}
/** Parent projects current theme tokens and the approved Brain palette once. */
export function createBrainStyles<
  const Styles extends Record<string, ViewStyle | TextStyle | ImageStyle>,
>(factory: (theme: BrainScreenTheme) => Styles) {
  return function useStyles(): Styles {
    const theme = useBrainScreenTheme();
    return useMemo(() => factory(theme), [theme]);
  };
}
export function withBrainTheme<Props extends object>(
  Component: ComponentType<Props>,
  map?: (theme: BrainScreenTheme) => Partial<Props>,
) {
  return function BrainThemedLeaf(
    props: Props & { uniProps?: (theme: BrainScreenTheme) => Partial<Props> },
  ) {
    const theme = useBrainScreenTheme();
    const mapper = props.uniProps ?? map;
    const resolved = mapper ? mapper(theme) : {};
    const leafProps = { ...props, ...resolved };
    delete leafProps.uniProps;
    return createElement(Component, leafProps);
  };
}
