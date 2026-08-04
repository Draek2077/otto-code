import { createPortal } from "react-dom";

// Navy hairline around the whole viewport, marking a dev build. See
// docs/development.md → "Lanes": the installed Otto and a dev Otto are expected
// to run together, and it has to be impossible to mistake one for the other.
const DEV_BORDER_COLOR = "#1e3a8a";
const DEV_BORDER_WIDTH = 2;

// Hoisted: a fresh object literal on every render would remount the portalled
// node's style for no reason.
const BORDER_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  border: `${DEV_BORDER_WIDTH}px solid ${DEV_BORDER_COLOR}`,
  // Never intercept a click: this paints above everything but is inert.
  pointerEvents: "none",
  zIndex: 2147483647,
};

// Two deliberate choices, both learned from the first attempt:
//
// 1. `position: fixed`, not `absolute`. An absolute box is laid out against its
//    nearest positioned ancestor and scrolls with content, so it only lines up
//    with the viewport while that ancestor happens to be exactly viewport-sized.
//    In fullscreen it was not, and the top and right edges landed outside the
//    visible area - leaving a border on two sides, which looks like a bug rather
//    than a signal.
//
// 2. Portalled to `document.body`. `fixed` is only viewport-relative while no
//    ancestor establishes a containing block, and `transform` / `filter` /
//    `will-change` all do - which Reanimated and the panel/sheet layers apply
//    freely. Rendering outside the app tree entirely means no ancestor can
//    reposition or clip this, whatever the layout does.
//
// This file is `.web.tsx` because `position: fixed` is not in React Native's
// style types and has no native meaning; the base module is the native no-op.
export function DevModeBorder() {
  // Expo's static web export renders without a DOM. Production never mounts this
  // (the caller gates on isDev), but returning null keeps it safe regardless.
  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div aria-hidden data-testid="dev-mode-border" style={BORDER_STYLE} />,
    document.body,
  );
}
