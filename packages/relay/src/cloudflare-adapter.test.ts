import { afterEach, describe, expect, it, vi } from "vitest";
import relayWorker, { RelayDurableObject } from "./cloudflare-adapter.js";

type DurableObjectStateArg = ConstructorParameters<typeof RelayDurableObject>[0];
type RelayEnvArg = Parameters<typeof relayWorker.fetch>[1];

type MockSocket = WebSocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  serializeAttachment: ReturnType<typeof vi.fn>;
  deserializeAttachment: ReturnType<typeof vi.fn>;
};

function createMockSocket(attachment: unknown = null): MockSocket {
  let storedAttachment = attachment;
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn((value: unknown) => {
      storedAttachment = value;
    }),
    deserializeAttachment: vi.fn(() => storedAttachment),
  } as unknown as MockSocket;
}

function createMockState() {
  const socketsByTag = new Map<string, WebSocket[]>();
  const state = {
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn((tag?: string): WebSocket[] => {
      if (!tag) {
        const out: WebSocket[] = [];
        for (const sockets of socketsByTag.values()) out.push(...sockets);
        return out;
      }
      return socketsByTag.get(tag) ?? [];
    }),
  };

  return {
    state,
    setTagSockets: (tag: string, sockets: WebSocket[]) => {
      socketsByTag.set(tag, sockets);
    },
  };
}

async function withMockWebSocketPair(
  run: (sockets: { clientWs: MockSocket; serverWs: MockSocket }) => Promise<void> | void,
): Promise<void> {
  const serverWs = createMockSocket();
  const clientWs = createMockSocket();
  const WebSocketPairMock = class {
    [index: number]: WebSocket;
    constructor() {
      this[0] = clientWs as unknown as WebSocket;
      this[1] = serverWs as unknown as WebSocket;
    }
  };

  const previousPair = (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = WebSocketPairMock;
  try {
    await run({ clientWs, serverWs });
  } finally {
    if (previousPair === undefined) {
      delete (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
    } else {
      (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = previousPair;
    }
  }
}

const swallow = () => undefined;

describe("RelayDurableObject versioning", () => {
  it("accepts legacy v1 client sockets without connectionId", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=1", {
        headers: {
          Upgrade: "websocket",
        },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
    });
  });

  it("assigns a connectionId when v2 client connects without one", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("https://relay.test/ws?role=client&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
      const attachment = serverWs.deserializeAttachment();
      expect(attachment).toMatchObject({
        role: "client",
        connectionId: expect.stringMatching(/^conn_/),
      });
    });
  });
});

describe("RelayDurableObject control nudge/reset behavior", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not nudge or reset control after the client already disconnected", () => {
    vi.useFakeTimers();
    const clientId = "clt_stale_timer";
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", []);
    setTagSockets(`client:${clientId}`, []);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(15_000);

    expect(control.send).not.toHaveBeenCalled();
    expect(control.close).not.toHaveBeenCalled();
  });

  it("resets control when the client remains connected but no server-data socket appears", () => {
    vi.useFakeTimers();
    const clientId = "clt_waiting_for_daemon";
    const control = createMockSocket();
    const client = createMockSocket({
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets("client", [client]);
    setTagSockets(`client:${clientId}`, [client]);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    (
      relay as unknown as { nudgeOrResetControlForConnection(id: string): void }
    ).nudgeOrResetControlForConnection(clientId);

    vi.advanceTimersByTime(10_000);
    expect(control.send).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5_000);
    expect(control.close).toHaveBeenCalledWith(1011, "Control unresponsive");
  });

  it("does not replace existing client sockets for the same connectionId", async () => {
    const existingClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: "clt_same_session",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets("client:clt_same_session", [existingClient]);
    setTagSockets("client", [existingClient]);

    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request(
        "https://relay.test/ws?role=client&serverId=srv_test&connectionId=clt_same_session&v=2",
        {
          headers: {
            Upgrade: "websocket",
          },
        },
      );

      await relay.fetch(req).catch(swallow);
      expect(existingClient.close).not.toHaveBeenCalled();
    });
  });

  it("keeps server data socket alive while at least one client socket remains", () => {
    const clientId = "clt_multi";
    const disconnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const stillConnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const serverData = createMockSocket();
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets(`server:${clientId}`, [serverData]);
    setTagSockets("client", [stillConnectedClient]);
    setTagSockets(`client:${clientId}`, [stillConnectedClient]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    relay.webSocketClose(
      disconnectedClient as unknown as WebSocket,
      1001,
      "Client disconnected",
      true,
    );

    expect(serverData.close).not.toHaveBeenCalled();
    expect(control.send).not.toHaveBeenCalledWith(
      JSON.stringify({ type: "disconnected", connectionId: clientId }),
    );
  });
});

describe("RelayDurableObject pending-frame byte caps", () => {
  function createClientSocket(connectionId: string): MockSocket {
    return createMockSocket({
      version: "2",
      role: "client",
      connectionId,
      serverId: "srv_test",
      createdAt: 0,
    });
  }

  const halfMiB = "x".repeat(512 * 1024);
  const oneMiB = "x".repeat(1024 * 1024);

  it("buffers client frames up to the per-connection byte cap, then closes the sender with 1009", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const client = createClientSocket("clt_hoarder");

    relay.webSocketMessage(client as unknown as WebSocket, halfMiB);
    relay.webSocketMessage(client as unknown as WebSocket, halfMiB);
    expect(client.close).not.toHaveBeenCalled();

    relay.webSocketMessage(client as unknown as WebSocket, halfMiB);
    expect(client.close).toHaveBeenCalledWith(1009, "Relay buffer full");
  });

  it("releases byte accounting when frames are flushed to a server data socket", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const client = createClientSocket("clt_flush");
    const serverData = createMockSocket();

    relay.webSocketMessage(client as unknown as WebSocket, oneMiB);
    (relay as unknown as { flushFrames(id: string, ws: WebSocket): void }).flushFrames(
      "clt_flush",
      serverData as unknown as WebSocket,
    );
    expect(serverData.send).toHaveBeenCalledTimes(1);

    relay.webSocketMessage(client as unknown as WebSocket, oneMiB);
    expect(client.close).not.toHaveBeenCalled();
  });

  it("releases byte accounting when the last client socket for a connection closes", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const client = createClientSocket("clt_leaver");

    relay.webSocketMessage(client as unknown as WebSocket, oneMiB);
    relay.webSocketClose(client as unknown as WebSocket, 1001, "gone", true);

    const reconnected = createClientSocket("clt_leaver");
    relay.webSocketMessage(reconnected as unknown as WebSocket, oneMiB);
    expect(reconnected.close).not.toHaveBeenCalled();
  });

  it("enforces the total byte cap across connectionIds", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

    for (let i = 0; i < 16; i++) {
      const client = createClientSocket(`clt_swarm_${i}`);
      relay.webSocketMessage(client as unknown as WebSocket, oneMiB);
      expect(client.close).not.toHaveBeenCalled();
    }

    const overflow = createClientSocket("clt_swarm_overflow");
    relay.webSocketMessage(overflow as unknown as WebSocket, oneMiB);
    expect(overflow.close).toHaveBeenCalledWith(1009, "Relay buffer full");
  });
});

describe("RelayDurableObject anonymous fairness controls", () => {
  it("refuses an orphan server data socket before it can allocate relay state", async () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const response = await relay.fetch(
      new Request(
        "https://relay.test/ws?role=server&serverId=srv_test&connectionId=clt_missing&v=2",
        { headers: { Upgrade: "websocket" } },
      ),
    );

    expect(response.status).toBe(409);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
  });

  it("caps concurrent anonymous client sockets in one relay session", async () => {
    const { state, setTagSockets } = createMockState();
    setTagSockets(
      "client",
      Array.from({ length: 4 }, () => createMockSocket()),
    );
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const response = await relay.fetch(
      new Request("https://relay.test/ws?role=client&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      }),
    );

    expect(response.status).toBe(429);
    expect(state.acceptWebSocket).not.toHaveBeenCalled();
  });

  it("closes a control socket that exceeds its anonymous message allowance", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const control = createMockSocket({
      version: "2",
      role: "server",
      connectionId: null,
      serverId: "srv_test",
      createdAt: Date.now(),
    });

    for (let i = 0; i < 6; i++) {
      relay.webSocketMessage(control as unknown as WebSocket, "not-a-control-message");
    }
    expect(control.close).not.toHaveBeenCalled();

    relay.webSocketMessage(control as unknown as WebSocket, "not-a-control-message");
    expect(control.close).toHaveBeenCalledWith(1013, "Relay message rate exceeded");
  });

  it("does not treat legacy v1 relay data as a v2 control message", () => {
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const legacyClient = createMockSocket({
      version: "1",
      role: "client",
      connectionId: null,
      serverId: "srv_test",
      createdAt: Date.now(),
    });

    for (let i = 0; i < 7; i++) {
      relay.webSocketMessage(legacyClient as unknown as WebSocket, "legacy-relay-data");
    }

    expect(legacyClient.close).not.toHaveBeenCalled();
  });
});

describe("relay worker endpoint routing", () => {
  it("routes missing v to legacy v1 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server", {
        headers: { Upgrade: "websocket" },
      }),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v1:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:1");
  });

  it("routes v=2 to v2 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=2", {
        headers: { Upgrade: "websocket" },
      }),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v2:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:2");
  });

  it("rejects invalid v values", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=nope", {
        headers: { Upgrade: "websocket" },
      }),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid v parameter (expected 1 or 2)");
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-WebSocket traffic before it reaches a Durable Object", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("https://relay.test/ws?serverId=srv_test&role=server&v=2"),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(426);
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects oversized route keys before they create a Durable Object", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request(`https://relay.test/ws?serverId=${"x".repeat(257)}&role=server&v=2`, {
        headers: { Upgrade: "websocket" },
      }),
      { RELAY: { idFromName, get } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("serverId is too long");
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
