/**
 * Whether the Zoom team-chat title-bar surface renders.
 *
 * Extracted and tested because the invariant is easy to get wrong in exactly
 * one direction, and has been twice: gating on availability instead of
 * connection. Going offline writes `enabled: false` for the provider, so a gate
 * on that flag deletes the whole icon the moment the user sets themselves
 * offline, and Settings becomes the only way back. Offline is a state the icon
 * reports, not the absence of one.
 *
 * The popup behind the icon is already built for the offline case: the status
 * picker resolves a disabled provider to "Offline" and offers Available as its
 * single selectable option, which is the documented transition back online.
 * That recovery path is only reachable if the surface renders.
 */
export function shouldShowZoomTeamChatTitlebar(input: {
  /** Desktop only. The surface has no mobile or browser form. */
  isDesktop: boolean;
  /** The provider is authorized and its connection is established. */
  isChatConnected: boolean;
  /**
   * Availability, which both the status picker's Offline option and the
   * Settings switch write. Accepted and deliberately NOT read: it is here so
   * that reintroducing it as a gate is a visible edit to this function and
   * fails its test, rather than a one-word change buried in a 2000-line
   * component.
   */
  isChatEnabled: boolean;
}): boolean {
  return input.isDesktop && input.isChatConnected;
}
