import { afterEach, expect, test } from "vitest";
import {
  DEFAULT_RELAY_ENDPOINT,
  buildRelayWebSocketUrl,
} from "@getpaseo/protocol/daemon-endpoints";
import { parseConnectionOfferFromUrl } from "@getpaseo/protocol/connection-offer";
import { generateLocalPairingOffer } from "../pairing-offer.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

// Opt in explicitly: this exercises Paseo's hosted service using an isolated home,
// the unchanged upstream transport and real encrypted RPCs, without invoking models.
const liveTest = process.env.RUN_LIVE_RELAY_E2E === "1" ? test : test.skip;
let daemon: TestPaseoDaemon | undefined;
let client: DaemonClient | undefined;

afterEach(async () => {
  try {
    await client?.close();
  } finally {
    await daemon?.close();
  }
});

liveTest(
  "pairs Otto and carries RPCs through Paseo's official relay",
  async () => {
    daemon = await createTestPaseoDaemon({
      daemonVersion: "0.10.0",
      relayEnabled: true,
      relayEndpoint: DEFAULT_RELAY_ENDPOINT,
      relayUseTls: true,
      relayPublicUseTls: true,
      agentClients: {},
      mcpEnabled: false,
      pluginsEnabled: false,
    });
    const pairing = await generateLocalPairingOffer({
      paseoHome: daemon.paseoHome,
      includeQr: false,
    });
    if (!pairing.url) throw new Error("Otto pairing did not produce a URL");
    expect(new URL(pairing.url).origin).toBe("https://app.otto-code.me");
    const offer = parseConnectionOfferFromUrl(pairing.url);
    if (!offer) throw new Error("Otto pairing did not produce a connection offer");
    expect(offer.relay).toEqual({ endpoint: DEFAULT_RELAY_ENDPOINT, useTls: true });

    const clientConfig = {
      url: buildRelayWebSocketUrl({
        endpoint: offer.relay.endpoint,
        useTls: true,
        serverId: offer.serverId,
        role: "client",
      }),
      clientType: "cli" as const,
      connectTimeoutMs: 20_000,
      e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
      reconnect: { enabled: false },
    };
    client = new DaemonClient(clientConfig);
    await client.connect();
    expect((await client.fetchAgents()).entries).toEqual([]);
    expect(client.getLastServerInfoMessage()).toMatchObject({
      serverId: offer.serverId,
      version: "0.10.0",
    });
    await client.close();
    client = new DaemonClient(clientConfig);
    await client.connect();
    expect((await client.fetchAgents()).entries).toEqual([]);
  },
  60_000,
);
