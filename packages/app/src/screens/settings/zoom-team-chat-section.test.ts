import { describe, expect, it } from "vitest";
import type { IntegrationAuthorizationOverview } from "@otto-code/protocol/integration-authorization";
import { shouldPollZoomTeamChatAuthorization } from "./zoom-team-chat-authorization-poll";
import { zoomTeamChatAccountLabel } from "./zoom-team-chat-connection-display";

const connection: IntegrationAuthorizationOverview["connections"][number] = {
  integrationId: "zoom-team-chat",
  connectionId: "primary",
  method: "oauth-pkce",
  state: "authorizing",
  accountLabel: null,
  grantedScopes: [],
  updatedAt: "2026-08-14T00:00:00.000Z",
  errorCode: null,
};

describe("shouldPollZoomTeamChatAuthorization", () => {
  it("keeps refreshing daemon status only for the browser flow started by this page", () => {
    expect(shouldPollZoomTeamChatAuthorization(connection, true)).toBe(true);
    expect(shouldPollZoomTeamChatAuthorization(connection, false)).toBe(false);
  });

  it("stops polling once OAuth reaches a terminal state", () => {
    expect(shouldPollZoomTeamChatAuthorization({ ...connection, state: "connected" }, true)).toBe(
      false,
    );
    expect(shouldPollZoomTeamChatAuthorization(undefined, true)).toBe(false);
  });
});

describe("zoomTeamChatAccountLabel", () => {
  it("shows the authorized Zoom email for a connected integration", () => {
    expect(
      zoomTeamChatAccountLabel({
        ...connection,
        state: "connected",
        accountLabel: "philippe.durand@curvedental.com",
      }),
    ).toBe("Signed in as philippe.durand@curvedental.com");
  });

  it("does not invent an account label before OAuth completes", () => {
    expect(zoomTeamChatAccountLabel(connection)).toBeNull();
  });
});
