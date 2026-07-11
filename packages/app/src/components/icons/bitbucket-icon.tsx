import Svg, { Path } from "react-native-svg";

interface BitbucketIconProps {
  size?: number;
  color?: string;
}

export function BitbucketIcon({ size = 16, color = "currentColor" }: BitbucketIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M0.778 1.213a0.768 0.768 0 0 0-0.768 0.892l3.263 19.81c0.084 0.5 0.515 0.868 1.022 0.873H19.95a0.772 0.772 0 0 0 0.77-0.646l3.27-20.03a0.768 0.768 0 0 0-0.768-0.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
    </Svg>
  );
}
