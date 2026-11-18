import { memo, useId, useMemo } from "react";
import { View } from "react-native";
import Svg, { SvgXml, Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { CHAT_STATUS_ARTWORK } from "./artwork";
import { MotionLayer } from "./motion-layer";
import { statusGlyph, statusGlyphColor, statusLabel, type AttentionBucket } from "./status";
const container = { alignItems: "center", justifyContent: "center", overflow: "visible" } as const;
const overlay = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  alignItems: "center",
  justifyContent: "center",
} as const;

/** Exact released glyph assets and 1.75x notify halo; independent of chat state ownership. */
export const ChatStatusIcon = memo(function ChatStatusIcon({
  bucket,
  size,
}: {
  bucket: AttentionBucket;
  size: number;
}) {
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const color = statusGlyphColor(bucket);
  const extent = size * 1.75;
  const halo = useMemo(() => ({ width: extent, height: extent }), [extent]);
  const label = statusLabel(bucket);
  return (
    <View style={container} accessibilityLabel={label}>
      <View style={overlay} pointerEvents="none">
        <MotionLayer kind="halo" active={retained && visible} style={halo}>
          <Svg width={extent} height={extent}>
            <Defs>
              <RadialGradient id={id} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={color} stopOpacity={0.38} />
                <Stop offset="38%" stopColor={color} stopOpacity={0.24} />
                <Stop offset="70%" stopColor={color} stopOpacity={0.08} />
                <Stop offset="100%" stopColor={color} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Rect width={extent} height={extent} fill={`url(#${id})`} />
          </Svg>
        </MotionLayer>
      </View>
      <SvgXml
        xml={CHAT_STATUS_ARTWORK[statusGlyph(bucket)]}
        width={size}
        height={size}
        color={color}
      />
    </View>
  );
});
