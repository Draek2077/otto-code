import { describe, expect, it } from "vitest";
import { DEFAULT_RELAY_ENDPOINT } from "../daemon-endpoints.js";
import { isOttoLegacyRelayEndpoint, migrateOttoLegacyRelayProfile } from "./legacy-relay.js";

const ottoRelay = {
  id: "relay:wss:relay.otto-code.me:443",
  type: "relay" as const,
  relayEndpoint: "relay.otto-code.me:443",
  daemonPublicKeyB64: "key",
};

describe("Otto legacy relay migration", () => {
  it("recognizes Otto's relay host with or without a port", () => {
    expect(isOttoLegacyRelayEndpoint("relay.otto-code.me:443")).toBe(true);
    expect(isOttoLegacyRelayEndpoint("relay.otto-code.me")).toBe(true);
    expect(isOttoLegacyRelayEndpoint(DEFAULT_RELAY_ENDPOINT)).toBe(false);
  });

  it("moves a saved Otto relay connection to Paseo's relay with TLS", () => {
    const migrated = migrateOttoLegacyRelayProfile({
      connections: [ottoRelay],
      preferredConnectionId: ottoRelay.id,
    });
    expect(migrated.connections).toEqual([
      {
        id: `relay:wss:${DEFAULT_RELAY_ENDPOINT}`,
        type: "relay",
        relayEndpoint: DEFAULT_RELAY_ENDPOINT,
        useTls: true,
        daemonPublicKeyB64: "key",
      },
    ]);
    expect(migrated.preferredConnectionId).toBe(`relay:wss:${DEFAULT_RELAY_ENDPOINT}`);
  });

  it("keeps direct connections and the preferred direct connection", () => {
    const direct = { id: "direct:localhost:6868", type: "directTcp", endpoint: "localhost:6868" };
    const migrated = migrateOttoLegacyRelayProfile({
      connections: [direct, ottoRelay],
      preferredConnectionId: direct.id,
    });
    expect(migrated.connections[0]).toBe(direct);
    expect(migrated.preferredConnectionId).toBe(direct.id);
  });

  it("drops the duplicate when a host already has Paseo's relay", () => {
    const paseoRelay = {
      id: `relay:wss:${DEFAULT_RELAY_ENDPOINT}`,
      type: "relay" as const,
      relayEndpoint: DEFAULT_RELAY_ENDPOINT,
      useTls: true,
      daemonPublicKeyB64: "key",
    };
    const migrated = migrateOttoLegacyRelayProfile({ connections: [paseoRelay, ottoRelay] });
    expect(migrated.connections).toEqual([paseoRelay]);
  });

  it("returns an unaffected profile unchanged", () => {
    const profile = { connections: [{ type: "directSocket", path: "/tmp/s" }] };
    expect(migrateOttoLegacyRelayProfile(profile)).toBe(profile);
  });
});
