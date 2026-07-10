import type { ViewStyle } from "react-native";
import { isWeb } from "@/constants/platform";

/**
 * Opt-out style for transient floating layers that render inside `#root`.
 *
 * Electron computes `-webkit-app-region` drag rects from UNCLIPPED bounding
 * boxes and ignores DOM z-order (electron/electron#7605). The scoped no-drag
 * backstop in `packages/app/public/index.html` only reaches interactive
 * elements inside drag-region containers and overlays portaled to `<body>`
 * (react-native-web Modal layers, `#overlay-root`). Anything floating inside
 * `#root` — gorhom bottom sheets and `@gorhom/portal` panels — must carve
 * itself out of the window drag rects with this style, or its contents are
 * click-dead wherever they overlap a titlebar strip or the New Workspace
 * screen's full-screen drag overlay. See docs/floating-panels.md Gotcha 7.
 *
 * Apply ONLY to views that exist while the panel is open. Stamping an
 * always-mounted full-screen host (e.g. FloatingPanelPortalHost's wrapper)
 * would permanently disable titlebar dragging — the exact unclipped-rect bug
 * the scoped backstop exists to prevent.
 *
 * `-webkit-app-region` is inert outside Electron, so plain browser web can
 * carry it; native styles must not (unknown web-only key), hence the gate.
 */
export const FLOATING_LAYER_NO_DRAG_STYLE: ViewStyle | null = isWeb
  ? ({ WebkitAppRegion: "no-drag" } as unknown as ViewStyle)
  : null;
