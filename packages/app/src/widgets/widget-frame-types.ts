import type { WidgetGuestMessage } from "@otto-code/protocol/widgets/bridge";

/**
 * The one interface all three widget renderers implement, so the card above
 * them never learns which platform it is on.
 */
export interface WidgetFrameProps {
  /** The full guest document, already assembled by `buildWidgetDocument`. */
  html: string;
  /** The tool call id. Frames for other widgets are filtered out by it. */
  widgetId: string;
  /** Host-owned frame height, driven by the guest's own measurements. */
  height: number;
  onGuestMessage: (message: WidgetGuestMessage) => void;
}
