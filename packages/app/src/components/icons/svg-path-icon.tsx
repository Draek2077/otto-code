import { withIconSizeToken, type IconSizeProp } from "@/components/icons/icon-size";
import Svg, { Path } from "react-native-svg";

export interface SvgPathIconProps {
  size?: IconSizeProp;
  color?: string;
}

interface SvgPathIconInput {
  size?: number;
  color?: string;
  path: string;
  viewBox: string;
}

function SvgPathIconBase({ size = 16, color = "currentColor", path, viewBox }: SvgPathIconInput) {
  return (
    <Svg width={size} height={size} viewBox={viewBox} fill={color}>
      <Path d={path} />
    </Svg>
  );
}

export const SvgPathIcon = withIconSizeToken(SvgPathIconBase, "SvgPathIcon");
