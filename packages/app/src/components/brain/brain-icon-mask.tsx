import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import MaskedView from "@react-native-masked-view/masked-view";
import { SvgXml } from "react-native-svg";

/**
 * Clip the animated fill to the brain shape, on native.
 *
 * The counterpart of `brain-icon-mask.web.tsx`; see that file for why the two
 * cannot share an implementation. This is the same `MaskedView` + translating
 * child rig the message-badge shimmer already uses, which is the pattern that
 * is known to hold up on device.
 */
export function BrainIconMask({
  maskSvg,
  size,
  children,
}: {
  maskSvg: string;
  size: number;
  children: ReactNode;
}) {
  const boxStyle = useMemo(() => ({ width: size, height: size }), [size]);
  const clipStyle = useMemo(
    () => ({ width: size, height: size, overflow: "hidden" as const }),
    [size],
  );
  const maskElement = useMemo(
    () => (
      <View style={boxStyle}>
        <SvgXml xml={maskSvg} width={size} height={size} />
      </View>
    ),
    [boxStyle, maskSvg, size],
  );

  return (
    <MaskedView pointerEvents="none" style={boxStyle} maskElement={maskElement}>
      <View pointerEvents="none" style={clipStyle}>
        {children}
      </View>
    </MaskedView>
  );
}
