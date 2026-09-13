import { describe, expect, it, vi } from "vitest";
import {
  buildDesktopDaemonTransportUrl,
  createDesktopDaemonTransportFactory,
} from "./desktop-daemon-transport";
import { createFakeLocalDaemonTransportRpc } from "./test-local-daemon-transport-rpc";

const LOCAL_URL = "otto+desktop://socket?path=%2Ftmp%2Fotto.sock";

describe("desktop-daemon-transport", () => {
  it("uses the main-process event as readiness when it races registration", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const cleanup = vi.fn();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });

    const onOpen = vi.fn();
    transport.onOpen(onOpen);

    rpc.resolveListen(cleanup);
    await Promise.resolve();

    const sessionId = rpc.openCalls[0]?.sessionId ?? "";
    expect(sessionId).not.toBe("");
    rpc.emitEvent({ sessionId, kind: "open" });
    expect(onOpen).toHaveBeenCalledTimes(1);

    rpc.resolveRegistration();
    await Promise.resolve();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("does not start a session when listener setup finishes after close", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const cleanup = vi.fn();

    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });

    transport.close();

    rpc.resolveListen(cleanup);
    await Promise.resolve();
    await Promise.resolve();

    expect(rpc.openCalls).toHaveLength(0);
    expect(rpc.closedSessions).toHaveLength(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("cancels a registered session while readiness is pending", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const transport = transportFactory!({ url: LOCAL_URL });
    rpc.resolveListen(vi.fn());
    await Promise.resolve();

    const sessionId = rpc.openCalls[0]?.sessionId ?? "";
    expect(sessionId).not.toBe("");

    transport.close();

    expect(rpc.closedSessions).toEqual([sessionId]);
  });

  it("passes Remote SSH parameters to the desktop transport bridge", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transportFactory = createDesktopDaemonTransportFactory(rpc);
    expect(transportFactory).not.toBeNull();

    const url = buildDesktopDaemonTransportUrl({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort: 2222,
      daemonPort: 7777,
    });
    transportFactory!({ url });
    rpc.resolveListen(vi.fn());
    await Promise.resolve();

    expect(rpc.openCalls).toHaveLength(1);
    expect(rpc.openCalls[0]?.target).toEqual({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort: 2222,
      daemonPort: 7777,
    });
  });

  it.each([0, 65536])("rejects an out-of-range Remote SSH port (%s)", (sshPort) => {
    const transportFactory = createDesktopDaemonTransportFactory(
      createFakeLocalDaemonTransportRpc(),
    );
    expect(transportFactory).not.toBeNull();

    const url = buildDesktopDaemonTransportUrl({
      transportType: "ssh",
      host: "deploy@example.com",
      sshPort,
    });

    expect(() => transportFactory!({ url })).toThrow("Invalid SSH transport target");
  });
});

describe("Otto local transport preservation", () => {
  it("keeps old local socket targets readable without allowing SSH through the old scheme", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const factory = createDesktopDaemonTransportFactory(rpc)!;
    factory({ url: "otto+local://socket?path=%2Ftmp%2Fotto.sock" });
    rpc.resolveListen(vi.fn());
    await Promise.resolve();
    expect(rpc.openCalls[0]?.target).toEqual({
      transportType: "socket",
      transportPath: "/tmp/otto.sock",
    });
    expect(() => factory({ url: "otto+local://ssh?host=remote" })).toThrow(
      "Unsupported desktop transport URL",
    );
  });

  it("sends text and binary only while this exact bridge session is open", async () => {
    const rpc = createFakeLocalDaemonTransportRpc();
    const transport = createDesktopDaemonTransportFactory(rpc)!({ url: LOCAL_URL });
    const received = vi.fn();
    transport.onMessage(received);
    transport.send("before");
    expect(rpc.recordedSends).toEqual([]);
    rpc.resolveListen(vi.fn());
    await Promise.resolve();
    const sessionId = rpc.openCalls[0]!.sessionId;
    rpc.emitEvent({ sessionId: "other", kind: "open" });
    transport.send("still-before");
    expect(rpc.recordedSends).toEqual([]);
    rpc.emitEvent({ sessionId, kind: "open" });
    transport.send("hello");
    transport.send(new Uint8Array([1, 2, 3]));
    expect(rpc.recordedSends).toEqual([
      { sessionId, text: "hello" },
      { sessionId, binaryBase64: "AQID" },
    ]);
    rpc.emitEvent({ sessionId: "other", kind: "message", text: "wrong host" });
    rpc.emitEvent({ sessionId, kind: "message", binaryBase64: "AQID" });
    expect(received).toHaveBeenCalledTimes(1);
    expect(received).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), true);
    transport.close();
    transport.close();
    transport.send("after");
    expect(rpc.recordedSends).toHaveLength(2);
    expect(rpc.closedSessions).toEqual([sessionId]);
  });
});
