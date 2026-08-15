import { describe, expect, test } from "vitest";
import { IntegrationConnectionMetadataSchema } from "./integration-authorization.js";

describe("IntegrationConnectionMetadataSchema", () => {
  test("keeps the persisted and wire-safe model free of credential values", () => {
    const metadata = IntegrationConnectionMetadataSchema.parse({
      integrationId: "zoom-team-chat",
      connectionId: "primary",
      method: "oauth-pkce",
      state: "connected",
      accountLabel: "otto@example.test",
      grantedScopes: ["team_chat:read:list_user_messages"],
      updatedAt: "2026-08-13T12:00:00.000Z",
      errorCode: null,
      accessToken: "must-not-survive-schema-boundary",
    });

    expect(metadata).not.toHaveProperty("accessToken");
    expect(metadata).toMatchObject({ integrationId: "zoom-team-chat", state: "connected" });
  });
});
