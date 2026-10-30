import { describe, expect, it } from "vitest";
import { GOOGLE_CONNECTOR_SERVICES } from "@getpaseo/plugin/otto/connectors";
import { ConnectorOAuthBroker } from "../oauth-broker.js";
import { GoogleOAuthSessions } from "./oauth.js";
import { GOOGLE_CONNECTOR_IDENTITY_SCOPES } from "./google-connector-scopes.js";
import { connectorServerSummary, type ConnectorBundle } from "../configuration.js";
import type { ConnectorEntry } from "../store.js";

describe("native Google callback composition", () => {
  it("keeps the original installed-app callback path and exchanges a code only on the host listener", async () => {
    const service = GOOGLE_CONNECTOR_SERVICES[0];
    let bundle: ConnectorBundle = {
      server: { type: "http", url: service.url, headers: {} },
      builtin: service.id,
      oauth: true,
      scope: "",
    };
    let value: string | null = null;
    let revision = "absent";
    let sequence = 0;
    const entry: ConnectorEntry = {
      id: "original-id",
      label: "Google",
      catalogId: service.id,
      generation: "generation",
      fingerprint: "config",
      enabled: false,
      disabledTools: [],
      server: connectorServerSummary(bundle.server),
      authorization: { state: "disconnected", account: null, scopes: [], message: null },
      verification: {
        state: "unverified",
        checkedAt: null,
        fingerprint: null,
        message: null,
        tools: [],
      },
    };
    const store = {
      open: async () => ({ revision: "settings", entry, bundle }),
      readBundleVersion: async () => ({ revision, value }),
      writeBundle: async (
        _entry: ConnectorEntry,
        expected: string,
        next: ConnectorBundle,
        admit?: () => boolean,
      ) => {
        if (expected !== revision || (admit && !admit())) throw new Error("conflict");
        bundle = next;
        value = JSON.stringify(next);
        revision = String(++sequence);
        return revision;
      },
    };
    const registration = {
      client_id: "preserved-client.apps.googleusercontent.com",
      client_secret: "fixture-publisher-secret",
    };
    const sessions = new GoogleOAuthSessions({ registration: async () => registration });
    let exchanges = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        exchanges++;
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code")).toBe("host-only-code");
        expect(body.get("client_id")).toBe(registration.client_id);
        expect(new URL(body.get("redirect_uri")!).pathname).toBe("/integrations/google/callback");
        return Response.json({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: [...service.scopes, ...GOOGLE_CONNECTOR_IDENTITY_SCOPES].join(" "),
        });
      }
      if (url === "https://www.googleapis.com/oauth2/v2/userinfo")
        return Response.json({ email: "preserved@example.test", verified_email: true });
      throw new Error("Unexpected fixture vendor request");
    };
    const outcomes: unknown[] = [];
    const broker = new ConnectorOAuthBroker({
      store,
      session: (options) => sessions.open(options),
      callbackPort: 0,
      callbackPathFor: () => "/integrations/google/callback",
      fetcher,
      settled: async (_id, _generation, outcome) => {
        outcomes.push(outcome);
      },
    });
    try {
      const started = await broker.begin(await store.open());
      const consent = new URL(started.authorizationUrl);
      const callback = new URL(consent.searchParams.get("redirect_uri")!);
      expect(callback.hostname).toBe("127.0.0.1");
      expect(callback.pathname).toBe("/integrations/google/callback");
      expect(started.authorizationUrl).not.toContain(registration.client_secret);
      callback.searchParams.set("state", consent.searchParams.get("state")!);
      callback.searchParams.set("code", "host-only-code");
      const response = await fetch(callback);
      expect(response.status).toBe(200);
      expect(outcomes).toEqual([{ connected: true }]);
      expect(exchanges).toBe(1);
      expect(bundle.authorization).toMatchObject({
        kind: "google-oauth-v1",
        clientId: registration.client_id,
        account: "preserved@example.test",
      });
      expect(value).not.toMatch(/host-only-code|fixture-publisher-secret/);
    } finally {
      await broker.close();
    }
  });
});
