import Svg, { Circle, Defs, G, RadialGradient, Stop } from "react-native-svg";

/** The crisp chat artwork from v0.9.35's blob-loader-glow, at its original geometry. */
export function GlowLayer({ color, gradientId }: { color: string; gradientId: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={gradientId} cx="76%" cy="20%" r="75%">
          <Stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <Stop offset="45%" stopColor={color} stopOpacity={0.35} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <G>
        <Circle
          cx={50}
          cy={50}
          r={40}
          stroke={`url(#${gradientId})`}
          strokeWidth={26}
          fill="none"
          opacity={0.16}
        />
        <Circle
          cx={50}
          cy={50}
          r={40}
          stroke={`url(#${gradientId})`}
          strokeWidth={16}
          fill="none"
          opacity={0.3}
        />
        <Circle
          cx={50}
          cy={50}
          r={40}
          stroke={`url(#${gradientId})`}
          strokeWidth={9}
          fill="none"
          opacity={0.95}
        />
        <Circle cx={50} cy={50} r={33} fill={`url(#${gradientId})`} opacity={0.14} />
      </G>
    </Svg>
  );
}
