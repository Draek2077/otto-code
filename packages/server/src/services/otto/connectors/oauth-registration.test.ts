import { describe, expect, it } from "vitest";
import {
  SLACK_OAUTH_REGISTRATION,
  DROPBOX_OAUTH_REGISTRATION,
  getConnectorOAuthRegistration,
} from "./oauth-registration.js";

describe("preserved publisher registrations", () => {
  it.each([
    {
      registration: SLACK_OAUTH_REGISTRATION,
      clientId: "12044001590499.12034876251863",
      callback: "http://127.0.0.1:6871/connectors/oauth/callback",
    },
    {
      registration: DROPBOX_OAUTH_REGISTRATION,
      clientId: "ir4e1ixjf542mq8",
      callback: "http://127.0.0.1:6872/connectors/oauth/callback",
    },
  ])(
    "keeps $clientId and its approved callback identical to the frozen 0.9 registration",
    ({ registration, clientId, callback }) => {
      expect(registration.clientId).toBe(clientId);
      expect(registration.redirectUri).toBe(callback);
      expect(
        getConnectorOAuthRegistration({
          server: { type: "http", url: registration.serverUrl, headers: {} },
        }),
      ).toBe(registration);
      expect(
        getConnectorOAuthRegistration({
          server: { type: "http", url: "https://unrelated.invalid/mcp", headers: {} },
        }),
      ).toBeUndefined();
    },
  );
  it("keeps the approved Dropbox offline-access consent request", () => {
    expect(DROPBOX_OAUTH_REGISTRATION.authorizationParams).toEqual({
      token_access_type: "offline",
    });
    expect(DROPBOX_OAUTH_REGISTRATION.scopes).toContain("files.content.write");
    expect(SLACK_OAUTH_REGISTRATION.scopes).toContain("chat:write");
  });
});
