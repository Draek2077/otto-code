import { describe, expect, it } from "vitest";
import {
  ConnectorActionSchema,
  ConnectorSummarySchema,
  authorizeConnector,
  readConnectors,
  writeConnectors,
} from "../connectors.js";

describe("Connector presentation boundary", () => {
  it("never accepts an authorization code from the client or returns a grant through the sign-in response", () => {
    const input = { hostId: "host", expectedRevision: "revision", id: "connector" };
    expect(authorizeConnector.input.safeParse(input).success).toBe(true);
    expect(
      authorizeConnector.input.safeParse({ ...input, authorizationCode: "code" }).success,
    ).toBe(false);
    expect(
      authorizeConnector.output.safeParse({
        ok: true,
        value: { authorizationUrl: "https://vendor.invalid/authorize", callback: "host-loopback" },
      }).success,
    ).toBe(true);
    expect(
      authorizeConnector.output.safeParse({
        ok: true,
        value: { authorizationUrl: null, accessToken: "secret" },
      }).success,
    ).toBe(false);
  });
  it("admits explicit write-only custom credentials without admitting daemon-owned OAuth state", () => {
    const input = {
      hostId: "host",
      expectedRevision: "revision",
      action: {
        kind: "add",
        label: "Private service",
        setup: {
          kind: "custom",
          server: {
            type: "http",
            url: "https://service.invalid/mcp",
            headers: { Authorization: "Bearer entered-token" },
          },
          oauth: false,
          scope: "",
        },
      },
    };
    expect(writeConnectors.input.safeParse(input).success).toBe(true);
    expect(
      writeConnectors.input.safeParse({ ...input, auth: { accessToken: "forged" } }).success,
    ).toBe(false);
    expect(
      writeConnectors.input.safeParse({
        ...input,
        action: { ...input.action, auth: { accessToken: "forged" } },
      }).success,
    ).toBe(false);
    expect(
      ConnectorActionSchema.safeParse({
        ...input.action,
        setup: { ...input.action.setup, auth: { accessToken: "forged" } },
      }).success,
    ).toBe(false);
  });

  it("keeps reads host-bound and does not accept renderer-chosen authorization material", () => {
    expect(readConnectors.input.safeParse({ hostId: "host" }).success).toBe(true);
    expect(
      readConnectors.input.safeParse({ hostId: "host", auth: { accessToken: "forged" } }).success,
    ).toBe(false);
    expect(readConnectors.input.safeParse({}).success).toBe(false);
  });

  it("never accepts a raw transport or existing OAuth token in the presentation snapshot", () => {
    const summary = {
      id: "custom",
      label: "Private service",
      catalogId: null,
      enabled: true,
      disabledTools: [],
      server: {
        type: "http",
        endpoint: "https://service.invalid/mcp",
        command: null,
        argumentCount: 0,
        environmentNames: [],
        headerNames: ["Authorization"],
      },
      authorization: { state: "connected", account: null, scopes: [], message: null },
      verification: {
        state: "unverified",
        checkedAt: null,
        fingerprint: null,
        message: null,
        tools: [],
      },
    };
    expect(ConnectorSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      ConnectorSummarySchema.safeParse({ ...summary, auth: { accessToken: "secret" } }).success,
    ).toBe(false);
    expect(
      ConnectorSummarySchema.safeParse({
        ...summary,
        server: { ...summary.server, headers: { Authorization: "secret" } },
      }).success,
    ).toBe(false);
    expect(
      ConnectorSummarySchema.safeParse({
        ...summary,
        authorization: { ...summary.authorization, refreshToken: "secret" },
      }).success,
    ).toBe(false);
  });
});
