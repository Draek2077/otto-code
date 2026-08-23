import { createElement, type ComponentType, type FunctionComponent } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { ICON_SIZE, type Theme } from "@/styles/theme";

/**
 * The size an icon is drawn at, named rather than measured.
 *
 * A number cannot express "the app's small icon", because that is 14pt under a
 * pointer and 28pt under a thumb. A token can, and it is resolved in one place
 * (`applyAppearance`) instead of at each of the several hundred call sites that
 * draw an icon. See `ICON_SIZE` for the two ladders and why `chrome*` exists.
 */
export type IconSizeToken = keyof typeof ICON_SIZE;

/**
 * What any slot that holds an icon should accept for `size`.
 *
 * Several surfaces declare their own icon-shaped prop bag - a button's left icon, a
 * panel descriptor, a tool-call glyph - and each one has to admit a token, or a
 * perfectly good icon stops being assignable to the slot it has always filled.
 */
export type IconSizeProp = number | IconSizeToken;

/**
 * An icon that only knows how to draw itself at a measured size. The inner half of
 * every icon: it takes pixels, and something above it decides what those are.
 */
export type NumericIconComponent = ComponentType<{
  size: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * An icon as the app uses it. `size` takes a token, which follows the form factor,
 * or a number for the handful of glyphs whose size is not on the ramp at all -
 * brand art, avatars, empty-state illustrations - which must not scale.
 */
export type IconComponent = ComponentType<{
  size?: IconSizeProp;
  color?: string;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * `color` is optional across every icon and every slot that holds one, and it has to
 * be, uniformly. React component props are invariant, so a mark that defaults its own
 * colour from the theme - the Otto logo, the Otto face - stops being assignable to a
 * slot that requires one, and a slot that makes it optional stops accepting the
 * Material icons that require one. There is no middle setting: either every
 * declaration of "an icon" agrees, or half the icons in the app fit half the slots.
 * The cost is that a colourless `<Search />` now compiles; it draws in the inherited
 * colour rather than failing the build.
 */

/**
 * One mapping per token, built once at module scope.
 *
 * These are `uniProps` functions, so they must be stable: a fresh closure per render
 * would defeat the wrapped leaf's memoisation and re-run the mapping on every parent
 * render, which is the cost `withUnistyles` exists to avoid.
 */
const SIZE_UNIPROPS: Record<IconSizeToken, (theme: Theme) => { size: number }> = {
  xs: (theme) => ({ size: theme.iconSize.xs }),
  sm: (theme) => ({ size: theme.iconSize.sm }),
  md: (theme) => ({ size: theme.iconSize.md }),
  mdPlus: (theme) => ({ size: theme.iconSize.mdPlus }),
  lg: (theme) => ({ size: theme.iconSize.lg }),
  chromeSm: (theme) => ({ size: theme.iconSize.chromeSm }),
  chromeMd: (theme) => ({ size: theme.iconSize.chromeMd }),
  chromeLg: (theme) => ({ size: theme.iconSize.chromeLg }),
  chromeXl: (theme) => ({ size: theme.iconSize.chromeXl }),
};

/**
 * Give a measured icon the app's token API.
 *
 * ## Why the token path goes through `withUnistyles`
 *
 * `size` is a plain prop, not `style`. The Babel plugin tracks `style` and updates
 * the ShadowTree without a React render, but it does not track arbitrary props, so an
 * icon that read `theme.iconSize.md` into a `size` prop would keep whatever number it
 * was first handed and never repaint when the breakpoint or the appearance changed.
 * That is the gap the old per-call-site `useIconSize()` hook was papering over, at the
 * cost of subscribing 60-odd components to every runtime change through
 * `useIsCompactFormFactor`. Folding `size` into `uniProps` closes it properly: only the
 * wrapped leaf re-renders, and it re-renders exactly when the token's value changes.
 *
 * ## Why a number is passed straight through
 *
 * A numeric `size` means "this glyph is not on the ramp" - brand art, an avatar, an
 * illustration - so it is drawn as asked and never scaled.
 *
 * The constraint admits `string` because that is how lucide types its own `size`, which
 * is exactly why lucide icons have to come through here: a token handed straight to one
 * type-checks, then silently renders at lucide's default 24.
 *
 * The return is a `FunctionComponent`, not a `ComponentType`. `ComponentType` is a union
 * that includes `ComponentClass`, whose `defaultProps` is an invariant `Partial<P>`, so a
 * wrapped icon stops being assignable to a slot over any prop it declares more loosely -
 * lucide's `color` is React Native's `ColorValue`, not `string`. This is a function
 * component; saying so keeps the class branch out of the comparison entirely. This is also what makes the
 * token migration safe to do file by file: an unmigrated call site keeps its exact
 * current pixels, and no glyph can end up scaled twice.
 */
export function withIconSizeToken<P extends { size?: number | string }>(
  Base: ComponentType<P>,
  displayName: string,
): FunctionComponent<Omit<P, "size"> & { size?: IconSizeProp }> {
  const Themed = withUnistyles(Base as ComponentType<Record<string, unknown>>);
  function TokenSizedIcon({ size = "md", ...rest }: Omit<P, "size"> & { size?: IconSizeProp }) {
    return typeof size === "number"
      ? createElement(Base as ComponentType<Record<string, unknown>>, { ...rest, size })
      : createElement(Themed, { ...rest, uniProps: SIZE_UNIPROPS[size] });
  }
  TokenSizedIcon.displayName = displayName;
  return TokenSizedIcon;
}

/** Every token, in ramp order. */
export const ICON_SIZE_TOKENS = Object.keys(SIZE_UNIPROPS) as readonly IconSizeToken[];

export function isIconSizeToken(value: unknown): value is IconSizeToken {
  return typeof value === "string" && value in SIZE_UNIPROPS;
}

/**
 * The stable `uniProps` mapping for a token, for components that cannot take
 * {@link withIconSizeToken} because `size` already means something else to them.
 *
 * The loading spinner is the case this exists for: it is an `ActivityIndicator`, whose
 * `size` is React Native's own `"small" | "large" | number`, and it already carries a
 * `uniProps` mapping for the accent colour. It composes this into that mapping rather
 * than being wrapped a second time.
 */
export function iconSizeUniProps(token: IconSizeToken): (theme: Theme) => { size: number } {
  return SIZE_UNIPROPS[token];
}
