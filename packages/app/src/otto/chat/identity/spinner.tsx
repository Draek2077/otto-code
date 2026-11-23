import { memo, useId, useMemo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useAppVisible } from "@/hooks/use-app-visible";
import { GlowLayer } from "./glow";
import { MotionLayer } from "./motion-layer";
import { chatSpinnerColors, type SpinnerColors } from "./palette";

interface Props {
  size?: number | "small" | "large";
  /** Accepted at the Paseo presentation seam; the identity uses its two-color palette. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  glowA?: string;
  glowB?: string;
  testID?: string;
}
const orbitStyle = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const;
function Spinner({
  size = 20,
  style,
  glowA,
  glowB,
  palette,
  testID,
}: Props & { palette: SpinnerColors }) {
  const retained = useRetainedPanelActive();
  const visible = useAppVisible();
  const active = retained && visible;
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pixels = typeof size === "number" ? size : { small: 18, large: 36 }[size];
  const frame = useMemo(() => ({ width: pixels, height: pixels }), [pixels]);
  return (
    <View style={[frame, style]} testID={testID}>
      <MotionLayer kind="wobble" active={active} style={frame}>
        <MotionLayer kind="spin-a" active={active} style={orbitStyle}>
          <GlowLayer color={glowA ?? palette.glowA} gradientId={`otto-chat-a-${id}`} />
        </MotionLayer>
        <MotionLayer kind="spin-b" active={active} style={orbitStyle}>
          <GlowLayer color={glowB ?? palette.glowB} gradientId={`otto-chat-b-${id}`} />
        </MotionLayer>
      </MotionLayer>
    </View>
  );
}
// Theme tracking stays at this leaf; no app-wide theme subscription or theme mutation.
export const ChatSpinner = memo(
  withUnistyles(Spinner, (_theme, runtime) => ({ palette: chatSpinnerColors(runtime.themeName) })),
);
