import { useMemo, type ReactNode } from "react";
import { View } from "react-native";

/**
 * Clip the animated fill to the brain shape, on web.
 *
 * `MaskedView` is a no-op in `@react-native-masked-view/masked-view`'s web
 * build - it renders the mask element and drops the children - so the native
 * path cannot be shared here. CSS `mask-image` is the real equivalent, and
 * clipping the container is what lets the fill underneath simply translate
 * without knowing anything about the shape it is being clipped to.
 *
 * Both the prefixed and unprefixed properties are set: react-native-web passes
 * unrecognised style keys straight through to the DOM (the same reason
 * `WebkitBackgroundClip` works for the message shimmer), and Safari still wants
 * the prefix.
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
  const maskStyle = useMemo(() => {
    const maskUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(maskSvg)}")`;
    return {
      width: size,
      height: size,
      overflow: "hidden",
      maskImage: maskUrl,
      maskSize: "contain",
      maskRepeat: "no-repeat",
      maskPosition: "center",
      WebkitMaskImage: maskUrl,
      WebkitMaskSize: "contain",
      WebkitMaskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
    } as object;
  }, [maskSvg, size]);

  return (
    <View pointerEvents="none" style={maskStyle}>
      {children}
    </View>
  );
}
