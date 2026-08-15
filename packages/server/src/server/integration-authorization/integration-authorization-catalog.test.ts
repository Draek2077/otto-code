import { describe, expect, test } from "vitest";
import { ZOOM_TEAM_CHAT_AUTHORIZATION_METHODS } from "../communications/zoom-team-chat-provider.js";
import { IntegrationAuthorizationCatalog } from "./integration-authorization-catalog.js";

describe("IntegrationAuthorizationCatalog", () => {
  test("declares Otto-managed Zoom sign-in as the only supported method", () => {
    const catalog = new IntegrationAuthorizationCatalog();
    catalog.registerMethods(ZOOM_TEAM_CHAT_AUTHORIZATION_METHODS);

    expect(catalog.listMethods("zoom-team-chat")).toEqual([
      {
        integrationId: "zoom-team-chat",
        method: "oauth-pkce",
        label: "Sign in with Zoom",
        description: "Recommended. Connect through Otto's managed Zoom sign-in flow.",
        recommended: true,
        availability: "available",
      },
    ]);
  });

  test("rejects duplicate provider method declarations", () => {
    const catalog = new IntegrationAuthorizationCatalog();
    catalog.registerMethods(ZOOM_TEAM_CHAT_AUTHORIZATION_METHODS);

    expect(() => catalog.registerMethods([ZOOM_TEAM_CHAT_AUTHORIZATION_METHODS[0]!])).toThrow(
      /already registered/i,
    );
  });
});
