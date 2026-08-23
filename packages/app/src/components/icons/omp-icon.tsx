import { withIconSizeToken } from "@/components/icons/icon-size";
import Svg, { Path } from "react-native-svg";

interface OmpIconProps {
  size?: number;
  color?: string;
}

function OmpIconBase({ size = 16, color = "currentColor" }: OmpIconProps) {
  return (
    <Svg width={size} height={size} viewBox="4 4 56 56" fill={color}>
      <Path d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
    </Svg>
  );
}

export const OmpIcon = withIconSizeToken(OmpIconBase, "OmpIcon");
