import { useEffect } from "react";
import { isWeb } from "@/constants/platform";
import { useAnimationsEnabled } from "@/hooks/use-animations-enabled";

/** Animate paint only; the anchor and content remain the sole owners of menu geometry. */
export function useMenuWebEnteringAnimation(surfaceNativeID: string, ready: boolean): void {
  const animationsEnabled = useAnimationsEnabled();
  useEffect(() => {
    if (!isWeb || !ready || !animationsEnabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const surface = document.getElementById(surfaceNativeID);
    if (!surface) return;

    // Reanimated's custom web keyframe cleanup restores a layout snapshot after 750ms.
    // That snapshot can be the initial (-9999, -9999) measurement box, making an open
    // menu disappear. Web Animations never writes top/left/width/height back to the DOM.
    const animation = surface.animate(
      [
        { opacity: 0, transform: "scale(0.97)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 150, easing: "linear" },
    );
    return () => animation.cancel();
  }, [animationsEnabled, ready, surfaceNativeID]);
}
