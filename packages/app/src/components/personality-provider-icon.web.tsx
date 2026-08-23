import { withIconSizeToken } from "@/components/icons/icon-size";
import { useId, useMemo } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { GLOW_DEFAULT_A, GLOW_DEFAULT_B } from "@/components/blob-loader";
import { getProviderIconSvg } from "@/components/provider-icons";
import type { PersonalityProviderIconProps } from "@/components/personality-provider-icon";

/**
 * Web path for {@link PersonalityProviderIcon}.
 *
 * Uses CSS `mask-image` (same technique as `brain-icon-mask.web.tsx`) to clip
 * a gradient `<rect>` to the provider icon's shape. The SVG source is converted
 * to a `data:` URL and applied as the mask — no `<SvgXml>` involved, so there
 * is no cross-document `url(#gradient)` problem.
 *
 * Both the prefixed and unprefixed properties are set: react-native-web passes
 * unrecognised style keys through to the DOM, and Safari still wants the prefix.
 */
function PersonalityProviderIconBase({
  provider,
  size,
  glowA = GLOW_DEFAULT_A,
  glowB = GLOW_DEFAULT_B,
}: PersonalityProviderIconProps) {
  const gradientId = `personality-icon-${useId().replace(/:/g, "")}`;
  const svgSource = useMemo(() => getProviderIconSvg(provider), [provider]);

  const maskStyle = useMemo(() => {
    const encoded = encodeURIComponent(
      svgSource
        // Strip `currentColor` — a mask has no inherited colour to resolve
        // against, and an unresolved currentColor masks everything away.
        .replace(/currentColor/g, "#000000"),
    );
    const maskUrl = `url("data:image/svg+xml;utf8,${encoded}")`;
    return {
      width: size,
      height: size,
      maskImage: maskUrl,
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
      WebkitMaskImage: maskUrl,
      WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
    } as object;
  }, [svgSource, size]);

  return (
    <View style={maskStyle}>
      <Svg width={size} height={size}>
        <Defs>
          {/* objectBoundingBox units: (0,0)→(1,1) is a 45° diagonal across the glyph. */}
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={glowA} />
            <Stop offset="1" stopColor={glowB} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} fill={`url(#${gradientId})`} />
      </Svg>
    </View>
  );
}

export const PersonalityProviderIcon = withIconSizeToken(
  PersonalityProviderIconBase,
  "PersonalityProviderIcon",
);
