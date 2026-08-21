import { describe, expect, it } from "vitest";
import { shouldShowZoomTeamChatTitlebar } from "./zoom-team-chat-titlebar-visibility";

describe("shouldShowZoomTeamChatTitlebar", () => {
  it("shows the surface for a connected, available desktop provider", () => {
    expect(
      shouldShowZoomTeamChatTitlebar({
        isDesktop: true,
        isChatConnected: true,
        isChatEnabled: true,
      }),
    ).toBe(true);
  });

  // The regression this module exists for, reported twice. Choosing Offline in
  // the status picker calls communicationsInboxSetEnabled({ enabled: false })
  // while the connection stays up. The icon must survive it, because the picker
  // behind it is the only route back online.
  it("keeps the surface when the user goes offline", () => {
    expect(
      shouldShowZoomTeamChatTitlebar({
        isDesktop: true,
        isChatConnected: true,
        isChatEnabled: false,
      }),
    ).toBe(true);
  });

  it("hides the surface when the provider is not connected", () => {
    expect(
      shouldShowZoomTeamChatTitlebar({
        isDesktop: true,
        isChatConnected: false,
        isChatEnabled: true,
      }),
    ).toBe(false);
  });

  it("hides the surface off desktop", () => {
    expect(
      shouldShowZoomTeamChatTitlebar({
        isDesktop: false,
        isChatConnected: true,
        isChatEnabled: true,
      }),
    ).toBe(false);
  });
});
