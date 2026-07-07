import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";
import { withUnistyles } from "react-native-unistyles";

// Otto's mark: the letters O·T·T·O drawn as a robot face (O's = eyes, T bars = brows,
// T stems = nose bridge). Geometry contract lives in branding/README.md — the masters
// in branding/ and these components must stay in sync.

interface OttoLogoProps {
  size?: number;
  color?: string;
}

function OttoLogoBase({ size = 64, color = "currentColor" }: OttoLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <Circle cx={114.72778} cy={280} r={70} stroke={color} strokeWidth={28} />
      <Circle cx={397.27271} cy={280} r={70} stroke={color} strokeWidth={28} />
      <Line x1={155.08434} y1={162} x2={251.08434} y2={162} stroke={color} strokeWidth={28} />
      <Line x1={216} y1={162} x2={216} y2={364} stroke={color} strokeWidth={28} />
      <Line x1={260.91559} y1={162} x2={356.91559} y2={162} stroke={color} strokeWidth={28} />
      <Line x1={296} y1={162} x2={296} y2={364} stroke={color} strokeWidth={28} />
      <Circle cx={114.72778} cy={280} r={22} fill={color} />
      <Circle cx={397.27271} cy={280} r={22} fill={color} />
    </Svg>
  );
}

function OttoLogoWordmarkBase({ size = 64, color = "currentColor" }: OttoLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <Circle cx={149.04579} cy={272} r={48} stroke={color} strokeWidth={20} />
      <Circle cx={363.21429} cy={272} r={48} stroke={color} strokeWidth={20} />
      <Line x1={167.08434} y1={194} x2={251.08434} y2={194} stroke={color} strokeWidth={20} />
      <Line x1={220} y1={194} x2={220} y2={330} stroke={color} strokeWidth={20} />
      <Line x1={260.91559} y1={194} x2={344.91559} y2={194} stroke={color} strokeWidth={20} />
      <Line x1={292} y1={194} x2={292} y2={330} stroke={color} strokeWidth={20} />
    </Svg>
  );
}

function OttoLogoRobotBase({ size = 64, color = "currentColor" }: OttoLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <Circle cx={149.04579} cy={272} r={14} fill={color} />
      <Circle cx={363.21429} cy={272} r={14} fill={color} />
      <Rect x={67.122879} y={236} width={36} height={72} rx={8} stroke={color} strokeWidth={14} />
      <Rect x={408.87665} y={236} width={36} height={72} rx={8} stroke={color} strokeWidth={14} />
      <Rect x={166} y={98} width={180} height={36} rx={8} stroke={color} strokeWidth={16} />
      <Line x1={196} y1={134} x2={196} y2={184} stroke={color} strokeWidth={12} />
      <Line x1={316} y1={134} x2={316} y2={184} stroke={color} strokeWidth={12} />
      <Line x1={208} y1={362} x2={208} y2={392} stroke={color} strokeWidth={12} />
      <Line x1={232} y1={362} x2={232} y2={392} stroke={color} strokeWidth={12} />
      <Line x1={256} y1={362} x2={256} y2={392} stroke={color} strokeWidth={12} />
      <Line x1={280} y1={362} x2={280} y2={392} stroke={color} strokeWidth={12} />
      <Line x1={304} y1={362} x2={304} y2={392} stroke={color} strokeWidth={12} />
      <Polyline points="176,424 256,464 336,424" stroke={color} strokeWidth={18} />
    </Svg>
  );
}

// Expression variant: raised left brow + winking right eye. Reserved for fun
// surfaces (branding/README.md) — geometry mirrors branding/otto-icon-wink.svg.
function OttoLogoWinkBase({ size = 64, color = "currentColor" }: OttoLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <Circle cx={114.72778} cy={280} r={70} stroke={color} strokeWidth={28} />
      <Line
        x1={145.8506}
        y1={105.85059}
        x2={249.8506}
        y2={157.8506}
        stroke={color}
        strokeWidth={28}
      />
      <Line x1={216} y1={146} x2={216} y2={364} stroke={color} strokeWidth={28} />
      <Line x1={260.91559} y1={162} x2={356.91559} y2={162} stroke={color} strokeWidth={28} />
      <Line x1={296} y1={162} x2={296} y2={364} stroke={color} strokeWidth={28} />
      <Path d="M312.91566 280 A84 84 0 0 1 480.91566 280 Z" fill={color} />
      <Path
        d="M326.91566 280 A70 70 0 0 0 466.91566 280"
        stroke={color}
        strokeWidth={28}
        fill="none"
      />
      <Circle cx={114.72778} cy={280} r={22} fill={color} />
    </Svg>
  );
}

const themedForeground = (theme: { colors: { foreground: string } }) => ({
  color: theme.colors.foreground,
});

// Face icon — the general-purpose mark for inline UI.
export const OttoLogo = withUnistyles(OttoLogoBase, themedForeground);

// Layers of the full logo (branding/otto-logo.svg). The splash screen stacks them and
// pulses the robot layer's opacity while the wordmark stays solid.
export const OttoLogoWordmark = withUnistyles(OttoLogoWordmarkBase, themedForeground);
export const OttoLogoRobot = withUnistyles(OttoLogoRobotBase, themedForeground);
export const OttoLogoWink = withUnistyles(OttoLogoWinkBase, themedForeground);
