import { useSettings } from "@/hooks/use-settings";
import type { VisualizerBackgroundProps } from "./background-types";
import { VisualizerBackground } from "./background";
import { visualizerPlacement } from "./preferences";
/** The conversation subtree and Composer keep their Paseo ownership. Only the
 * opted-in, fixed visible conversation viewport gains a presentation backdrop. */
export function VisualizerChatBoundary(props: VisualizerBackgroundProps) {
  const enabled = useSettings((settings) => visualizerPlacement(settings) === "background");
  // Keep the same foreground element while toggling placement; reparenting the
  // stream here would remount its reader/scroll anchor.
  return <VisualizerBackground {...props} enabled={enabled} />;
}
/** Keep the app seam a single presentation slot instead of expanding its dock. */
export function visualizerChatViewport(props: VisualizerBackgroundProps) {
  return <VisualizerChatBoundary {...props} />;
}
