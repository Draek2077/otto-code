import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

/**
 * The dissolve between state pictures.
 *
 * Every picture is drawn inside an absolute size-box layer with the container's
 * centring, so a frozen copy stacks pixel-for-pixel over a live one. When
 * `pictureKey` changes, the last-rendered picture is frozen as an outgoing
 * layer drawn on top of the incoming one and faded out - fade-out-over rather
 * than a paired fade-in/fade-out, because the two pictures share the same brain
 * silhouette, so dimming both mid-fade would read as the icon blinking.
 *
 * The frozen picture is the previous React subtree, still mounted: its own
 * sweep keeps running while it fades, and its props (theme, size) simply stop
 * updating for the fraction of a second it remains. A second key change
 * mid-fade replaces the outgoing layer outright; two generations of ghosts are
 * never stacked.
 */
export function BrainStateCrossfade({
  pictureKey,
  size,
  style,
  durationMs,
  enabled,
  children,
}: {
  pictureKey: string;
  size: number;
  style?: StyleProp<ViewStyle>;
  durationMs: number;
  /** Off (Appearance → Animations): pictures swap instantly, no ghost layer. */
  enabled: boolean;
  children: React.ReactNode;
}) {
  const containerStyle = useMemo(
    () => [
      {
        width: size,
        height: size,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        overflow: "visible" as const,
      },
      style,
    ],
    [size, style],
  );
  const layerStyle = useMemo<ViewStyle>(
    () => ({
      position: "absolute",
      top: 0,
      left: 0,
      width: size,
      height: size,
      alignItems: "center",
      justifyContent: "center",
      overflow: "visible",
    }),
    [size],
  );

  const [renderedKey, setRenderedKey] = useState(pictureKey);
  const [outgoing, setOutgoing] = useState<{ id: number; node: React.ReactNode } | null>(null);
  // The children as of the previous render: what gets frozen when the key
  // flips. A ref, not state, so tracking it costs nothing on the renders
  // where nothing changes.
  const lastPictureRef = useRef(children);
  const outgoingIdRef = useRef(0);

  if (!enabled && outgoing !== null) {
    setOutgoing(null);
  }

  if (renderedKey !== pictureKey) {
    // React's documented render-phase pattern for deriving state from a prop
    // change: set state during render and let React restart the render with it,
    // instead of committing the new picture for a frame and fading only after
    // an effect fires.
    setRenderedKey(pictureKey);
    if (enabled && durationMs > 0) {
      outgoingIdRef.current += 1;
      setOutgoing({ id: outgoingIdRef.current, node: lastPictureRef.current });
    } else if (outgoing !== null) {
      setOutgoing(null);
    }
  }
  lastPictureRef.current = children;

  // Only clear if the finished ghost is still the one on screen: a fade that
  // was superseded mid-flight must not remove its replacement.
  const handleFadedOut = useCallback((id: number) => {
    setOutgoing((current) => (current !== null && current.id === id ? null : current));
  }, []);

  return (
    <View pointerEvents="none" style={containerStyle}>
      <View pointerEvents="none" style={layerStyle}>
        {children}
      </View>
      {outgoing && enabled ? (
        <BrainCrossfadeOut
          key={outgoing.id}
          id={outgoing.id}
          style={layerStyle}
          durationMs={durationMs}
          onDone={handleFadedOut}
        >
          {outgoing.node}
        </BrainCrossfadeOut>
      ) : null}
    </View>
  );
}

/** One frozen outgoing picture, fading from opaque to gone over `durationMs`. */
function BrainCrossfadeOut({
  id,
  style,
  durationMs,
  onDone,
  children,
}: {
  id: number;
  style: StyleProp<ViewStyle>;
  durationMs: number;
  onDone: (id: number) => void;
  children: React.ReactNode;
}) {
  const opacity = useSharedValue(1);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const finish = () => onDoneRef.current(id);
    opacity.value = withTiming(
      0,
      {
        duration: durationMs,
        easing: Easing.linear,
        // Motion policy is already resolved by the injected lifecycle boundary.
        reduceMotion: ReduceMotion.Never,
      },
      (finished) => {
        if (finished) {
          runOnJS(finish)();
        }
      },
    );
    return () => {
      cancelAnimation(opacity);
    };
  }, [durationMs, id, opacity]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" style={[style, fadeStyle]}>
      {children}
    </Animated.View>
  );
}
