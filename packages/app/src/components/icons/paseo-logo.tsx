import Svg, { Circle, Line } from "react-native-svg";
import { useUnistyles } from "react-native-unistyles";

interface PaseoLogoProps {
  size?: number;
  color?: string;
}

// OTTO(identity): renders Otto's face mark (branding/otto-icon.svg) instead of Paseo's logo.
export function PaseoLogo({ size = 64, color }: PaseoLogoProps) {
  const { theme } = useUnistyles();
  const fill = color ?? theme.colors.foreground;

  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill="none">
      <Circle cx={114.72778} cy={280} r={70} stroke={fill} strokeWidth={28} />
      <Circle cx={397.27271} cy={280} r={70} stroke={fill} strokeWidth={28} />
      <Line x1={155.08434} y1={162} x2={251.08434} y2={162} stroke={fill} strokeWidth={28} />
      <Line x1={216} y1={162} x2={216} y2={364} stroke={fill} strokeWidth={28} />
      <Line x1={260.91559} y1={162} x2={356.91559} y2={162} stroke={fill} strokeWidth={28} />
      <Line x1={296} y1={162} x2={296} y2={364} stroke={fill} strokeWidth={28} />
      <Circle cx={114.72778} cy={280} r={22} fill={fill} />
      <Circle cx={397.27271} cy={280} r={22} fill={fill} />
    </Svg>
  );
}
