import { useId, useMemo } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Stop } from "react-native-svg";
import { GLOW_DEFAULT_A, GLOW_DEFAULT_B } from "@/components/blob-loader";
import { getProviderIcon } from "@/components/provider-icons";
import type { PersonalityProviderIconProps } from "@/components/personality-provider-icon";

const HIDDEN_DEFS_STYLE = { position: "absolute" as const };

/**
 * Web path for {@link PersonalityProviderIcon}. MaskedView is a no-op on web, so
 * instead we render a hidden gradient `<defs>` and point the provider icon's
 * fill at it via `url(#id)` — browsers resolve gradient refs across `<svg>`
 * elements document-wide. The id is per-instance (useId) so multiple triggers
 * with different personality colors don't collide.
 */
export function PersonalityProviderIcon({
  provider,
  size,
  glowA = GLOW_DEFAULT_A,
  glowB = GLOW_DEFAULT_B,
}: PersonalityProviderIconProps) {
  const Icon = getProviderIcon(provider);
  const gradientId = `personality-icon-${useId().replace(/:/g, "")}`;
  const containerStyle = useMemo(() => ({ width: size, height: size }), [size]);
  return (
    <View style={containerStyle}>
      <Svg width={0} height={0} style={HIDDEN_DEFS_STYLE}>
        <Defs>
          {/* objectBoundingBox units: (0,0)→(1,1) is a 45° diagonal across the glyph. */}
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={glowA} />
            <Stop offset="1" stopColor={glowB} />
          </LinearGradient>
        </Defs>
      </Svg>
      <Icon size={size} color={`url(#${gradientId})`} />
    </View>
  );
}
