import { FadeIn, Keyframe } from "react-native-reanimated";
import { isWeb } from "@/constants/platform";

export const MENU_SURFACE_ENTERING_DURATION_MS = 150;

const nativeEntering = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.97 }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
}).duration(MENU_SURFACE_ENTERING_DURATION_MS);

// Custom web keyframes restore their animation-end geometry during delayed cleanup. A popup
// may have grown since then; predefined FadeIn leaves all sizing and anchoring to the surface.
export const menuSurfaceEntering = isWeb
  ? FadeIn.duration(MENU_SURFACE_ENTERING_DURATION_MS)
  : nativeEntering;
