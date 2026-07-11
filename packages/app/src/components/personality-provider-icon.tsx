import MaskedView from "@react-native-masked-view/masked-view";
import { useMemo } from "react";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { GLOW_DEFAULT_A, GLOW_DEFAULT_B } from "@/components/blob-loader";
import { getProviderIcon } from "@/components/provider-icons";

export interface PersonalityProviderIconProps {
  provider: string;
  size: number;
  /** Personality spinner colors — the gradient's two stops. Default to the
   * shared glow pair when a personality has no custom colors. */
  glowA?: string;
  glowB?: string;
}

/**
 * A provider icon filled with the personality's two colors as a **static** 45°
 * diagonal gradient — the identity reads on the familiar provider glyph without
 * the animated spinner (which looked like "processing"). Native path: the icon
 * shape masks a gradient rect via MaskedView. See the `.web.tsx` sibling for the
 * browser path (MaskedView is a no-op on web).
 */
export function PersonalityProviderIcon({
  provider,
  size,
  glowA = GLOW_DEFAULT_A,
  glowB = GLOW_DEFAULT_B,
}: PersonalityProviderIconProps) {
  const Icon = getProviderIcon(provider);
  const containerStyle = useMemo(() => ({ width: size, height: size }), [size]);
  const maskElement = useMemo(() => <Icon size={size} color="#000000" />, [Icon, size]);
  return (
    <MaskedView style={containerStyle} maskElement={maskElement}>
      <Svg width={size} height={size}>
        <Defs>
          {/* objectBoundingBox units: (0,0)→(1,1) is a 45° diagonal across the glyph. */}
          <LinearGradient id="personalityProviderIconGradient" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={glowA} />
            <Stop offset="1" stopColor={glowB} />
          </LinearGradient>
        </Defs>
        <Rect width={size} height={size} fill="url(#personalityProviderIconGradient)" />
      </Svg>
    </MaskedView>
  );
}
