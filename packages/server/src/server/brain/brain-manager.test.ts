import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { BrainHostStatus, MutableBrainConfig } from "@otto-code/protocol/messages";
import { DEFAULT_MUTABLE_BRAIN_CONFIG } from "@otto-code/protocol/messages";

import { createTestLogger } from "../../test-utils/test-logger.js";
import type { ManagedProcessRegistry } from "../managed-processes/managed-processes.js";
import { BrainManager } from "./brain-manager.js";

// A long-lived (100-year) self-signed keypair generated once with the same
// `selfsigned` options the brain's CertManager uses (CN otto-brain-test, SANs
// localhost/127.0.0.1). Static so the tests are deterministic and the server
// package needs no cert-generation dependency.
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIC4jCCAcqgAwIBAgIJBaNnRG8s9szDMA0GCSqGSIb3DQEBCwUAMBoxGDAWBgNV
BAMTD290dG8tYnJhaW4tdGVzdDAgFw0yNjA4MDIxNzIyMjNaGA8yMTI2MDcwOTE3
MjIyM1owGjEYMBYGA1UEAxMPb3R0by1icmFpbi10ZXN0MIIBIjANBgkqhkiG9w0B
AQEFAAOCAQ8AMIIBCgKCAQEA3QN7+tu1QYddi5I7SANuDPrWEq+hkfP0DqPzS6Ox
Z25INEBahzwBJqON38zI7gYqI1UgdXt4m3ug1pQjDUGy2cQiyytXVivX/jxtJ24G
rIxBQ/KM1F2xGhR5lmr09WmrgR0khgl39KZPtOv271dF1Uc104WMQdOf+uwlZZT6
cg5t7sR8kV+WWIjZJxG1BXts+Z5ktgAok/Ww3IT07RsVKi0Aw9XoMdigZV+5WQ3k
ahu/Zs80sZHJLduCLb6sfL3GFCEEn5Vsmv33Z1iBBg8zO8wG5CB2KgdNHHGvNSkS
w7HpgiT776qx9/wNP/veqGoIWPGogMxpNHSdgRoyi13yzQIDAQABoykwJzAJBgNV
HRMEAjAAMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAAATANBgkqhkiG9w0BAQsF
AAOCAQEAcFsIeRZ043LiNNW1L3rvtTOlkkn+VNqHHWvH466kHKFdVx8f0CJSvb1p
rftGU1wGlUKElC9JCkm1Qdz9fodUwvQuttG4P+fNdKCGhz+EY8NLNRty6LdFPmkV
p2DoTq1eQgoYkdaTJ9AFQH5fhrw7MPOcZkGGlPjdscjBRnUNFfz1zaoxJhkb8c8w
/ctnxnGNGgmKTXRlrMvFyO0eGKu1TfcFXIjic/jcEp6dxYUAWKMqCn5VrmNHD1AO
WDZtaYRrXdKQeEUUehpidS0ZMfSJy+wPg2Qr8YoRg6cJQSbMlTeeWiQmw4YCospM
21y7qrjNESLO/1ZMFQf7MQbHPV3htA==
-----END CERTIFICATE-----
`;

const TEST_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA3QN7+tu1QYddi5I7SANuDPrWEq+hkfP0DqPzS6OxZ25INEBa
hzwBJqON38zI7gYqI1UgdXt4m3ug1pQjDUGy2cQiyytXVivX/jxtJ24GrIxBQ/KM
1F2xGhR5lmr09WmrgR0khgl39KZPtOv271dF1Uc104WMQdOf+uwlZZT6cg5t7sR8
kV+WWIjZJxG1BXts+Z5ktgAok/Ww3IT07RsVKi0Aw9XoMdigZV+5WQ3kahu/Zs80
sZHJLduCLb6sfL3GFCEEn5Vsmv33Z1iBBg8zO8wG5CB2KgdNHHGvNSkSw7HpgiT7
76qx9/wNP/veqGoIWPGogMxpNHSdgRoyi13yzQIDAQABAoIBAAEbUDFzNzGi+WNx
By3298PwikY2re2aq0la0HrmUMWZUPA+CutWxWoJnfTAbu3OMcN9MiKUdzKkHavl
Zarefi7xTfv2ysL/iN8uM0e5bnwftFX1mXdDbtcYF3xwKwDYQh0X5cPBZAyMEVBx
HAqab8WVITO0HVMuZESFOTIMhcKGG0Fo7BBt09FVB4wtcmGg7C/6o23gXrcZFHHa
eLXl2nO7ZKzyIId4jIxglm1dkkby43/YfpaQwml2wquq+dZSHZa+TPhl5Gowxtjc
XcUAUx03YupHze2WWMLCPTUHi5K1g2VtltNO7y2ksSLqaPS+3ndnjxRYlsvQQrx2
s4MJj5sCgYEA+F2sacksmshNhwyY6h71w3aQ3zdlCvFulnfFuGNensYM2d/lfwQJ
OLiF29RkJ0lRbI8S2b+nw7jXEWjjxTyZGC2wlWfpxr7l6TZefCUiZRmXSzoZMaQm
BwSCw0p9lVecbpvDcHwfKx5c2rgEAfm8hHDD8HQuctIKZZmiNpgF8CMCgYEA486V
KxS7kPTaSw0VrM7h20EkFe4OPN0QfvKHaPmhJXR/hnJ1sivMh5YfUODYTY8shok2
GeP9zR3FzFsJ1boiaNeS2hCkpKAB7Gj6DCH9OiTvl6ZYwSl8HEa9Jv5+0JBKcbbv
1/ryxO/TYBUg6ruORrdnMrpQ4esEP2ZpklJ1SE8CgYEAxSTt96Z1XoOCbqGEO8rJ
gBb8VgLNlMsh4hQ+gOd3swY4KzV7IMBeZYSq1F0aBsk+9bH335ovG7/8D1i3+9bn
GvchhObP/S+Ipf6/L0H2tFOE8XSzjODkQovFFClr2ACMLow7rW0I/JwETqTkoYDP
sD0mexZtzDyHfjBeP4GarQsCgYEA1mkShujNnSKH7wmStAJIG6gVAbr8lZZvtzwn
7Mq/PFSIzo8ebaLBr3/BW8s0atNt0faFABtRPuRdzfiFqi61wj3cDviJLhUXml43
soGvKDGpe+9qK+wSzz5ZO8FetIiKOLs4xOyB4I/lP9LDF4uN3ssyC1HHXMtpRQ7s
IHcRwgsCgYAW1H1SwHgIxATADOUtIPPjWHn8OMVHoGF955uZAtyW9/oHrya+EN11
FhXJ4/FOSXLOsbsIbyaHqnJFVqpVE8BYzYtnjpDyefbamRKe1psXQRYXKh6jqklQ
WL3T2CZe/1AcsDfZbbqDurv2naK4J0B9p3n4OeCUhkWtpWhdMEQgXQ==
-----END RSA PRIVATE KEY-----
`;

/** SHA-256 fingerprint of TEST_CERT, as Node/openssl print it. */
const TEST_CERT_FINGERPRINT =
  "BA:2C:4A:62:94:B4:B8:4E:DF:AB:94:3C:C8:81:ED:D0:A3:31:62:A0:F6:92:43:90:69:59:F0:6F:DE:0B:29:AE";

/** A well-formed SHA-256 fingerprint that matches no certificate. */
const WRONG_FINGERPRINT = "00".repeat(32);

interface SeenRequest {
  method: string | undefined;
  path: string | undefined;
  token: string | undefined;
}

interface TestBrainServer {
  port: number;
  requests: SeenRequest[];
  close(): Promise<void>;
}

// A stand-in for the remote brain's host API: records every request that
// actually reaches the HTTP layer (a request that never appears here never
// received headers, and therefore never received the auth token) and answers
// /__host/* with minimal valid JSON.
function createHandler(requests: SeenRequest[]): http.RequestListener {
  return (req, res) => {
    const token = req.headers["x-otto-brain-token"];
    requests.push({
      method: req.method,
      path: req.url,
      token: typeof token === "string" ? token : undefined,
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ state: "ready" }));
  };
}

function listen(
  server: http.Server | https.Server,
  requests: SeenRequest[],
): Promise<TestBrainServer> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        port,
        requests,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function startTlsBrainServer(): Promise<TestBrainServer> {
  const requests: SeenRequest[] = [];
  const server = https.createServer({ cert: TEST_CERT, key: TEST_KEY }, createHandler(requests));
  return listen(server, requests);
}

function startPlainBrainServer(): Promise<TestBrainServer> {
  const requests: SeenRequest[] = [];
  const server = http.createServer(createHandler(requests));
  return listen(server, requests);
}

// Remote mode never records a child process, so the registry can be inert.
function createRegistryStub(): ManagedProcessRegistry {
  return {
    record: () => Promise.reject(new Error("not used in remote mode")),
    remove: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    reapStale: () => Promise.reject(new Error("not used in remote mode")),
  };
}

function remoteConfig(overrides: Partial<MutableBrainConfig["remote"]>): MutableBrainConfig {
  return {
    ...DEFAULT_MUTABLE_BRAIN_CONFIG,
    mode: "remote",
    remote: { ...DEFAULT_MUTABLE_BRAIN_CONFIG.remote, ...overrides },
  };
}

describe("BrainManager remote TLS trust", () => {
  let ottoHome: string;
  let manager: BrainManager;
  let brainServer: TestBrainServer | null;

  beforeEach(() => {
    ottoHome = mkdtempSync(path.join(tmpdir(), "otto-brain-manager-test-"));
    manager = new BrainManager({
      logger: createTestLogger(),
      managedProcesses: createRegistryStub(),
      ottoHome,
    });
    brainServer = null;
  });

  afterEach(async () => {
    await manager.shutdown();
    await brainServer?.close();
    rmSync(ottoHome, { recursive: true, force: true });
  });

  test("a pinned self-signed remote is reachable and receives the token", async () => {
    brainServer = await startTlsBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: TEST_CERT_FINGERPRINT,
      }),
    );

    const status = await manager.status();
    expect(status.running).toBe(true);
    expect(brainServer.requests).toHaveLength(1);
    expect(brainServer.requests[0]?.token).toBe("secret-token");
  });

  test("the pin accepts lowercase, colon-free fingerprints", async () => {
    brainServer = await startTlsBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: TEST_CERT_FINGERPRINT.replaceAll(":", "").toLowerCase(),
      }),
    );

    const status = await manager.status();
    expect(status.running).toBe(true);
  });

  test("a certificate that does not match the pin gets nothing, token included", async () => {
    brainServer = await startTlsBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: WRONG_FINGERPRINT,
      }),
    );

    const status = await manager.status();
    expect(status.running).toBe(false);
    expect(status.state).toBe("unreachable");
    // The credential-disclosure regression: no HTTP request (and so no token
    // header) may ever reach a peer whose certificate failed the pin.
    expect(brainServer.requests).toHaveLength(0);
  });

  test("with no pin, a self-signed remote fails system-store validation and gets nothing", async () => {
    brainServer = await startTlsBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: null,
      }),
    );

    const status = await manager.status();
    expect(status.running).toBe(false);
    expect(status.state).toBe("unreachable");
    expect(brainServer.requests).toHaveLength(0);
  });

  test("a malformed pin fails closed instead of disabling validation", async () => {
    brainServer = await startTlsBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: "not-a-fingerprint",
      }),
    );

    const status = await manager.status();
    expect(status.running).toBe(false);
    expect(brainServer.requests).toHaveLength(0);
  });

  test("config writes (POST) go through the same pinned trust path", async () => {
    brainServer = await startTlsBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: TEST_CERT_FINGERPRINT,
      }),
    );

    const result = await manager.patchRemoteConfig({ defaultModel: "m" });
    expect(result).toEqual({ state: "ready" });
    expect(brainServer.requests[0]?.method).toBe("POST");
    expect(brainServer.requests[0]?.token).toBe("secret-token");

    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: WRONG_FINGERPRINT,
      }),
    );
    await expect(manager.patchRemoteConfig({ defaultModel: "m" })).rejects.toThrow(
      /pinned fingerprint/u,
    );
    expect(brainServer.requests).toHaveLength(1);
  });

  test("a plain-HTTP remote keeps working unchanged", async () => {
    brainServer = await startPlainBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: false,
        authToken: "secret-token",
      }),
    );

    const status = await manager.status();
    expect(status.running).toBe(true);
    expect(brainServer.requests[0]?.token).toBe("secret-token");
  });

  test("posts an inventory rescan through the host API", async () => {
    brainServer = await startPlainBrainServer();
    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: false,
        authToken: "secret-token",
      }),
    );

    await manager.rescanInventory();

    expect(brainServer.requests.at(-1)).toMatchObject({
      method: "POST",
      path: "/__host/models/rescan",
      token: "secret-token",
    });
  });
});

// The otto-brain agent provider has no URL or API-key setting of its own: it
// asks the manager where the host is on every request. These cover the answers
// that make the Providers row red and empty its model list.
describe("BrainManager.getProviderEndpoint", () => {
  let ottoHome: string;
  let manager: BrainManager;

  beforeEach(() => {
    ottoHome = mkdtempSync(path.join(tmpdir(), "otto-brain-endpoint-test-"));
    manager = new BrainManager({
      logger: createTestLogger(),
      managedProcesses: createRegistryStub(),
      ottoHome,
    });
  });

  afterEach(async () => {
    await manager.shutdown();
    rmSync(ottoHome, { recursive: true, force: true });
  });

  test("is unavailable before any settings have been applied", () => {
    expect(manager.getProviderEndpoint()).toEqual({
      state: "unavailable",
      reason: expect.stringContaining("not loaded"),
    });
  });

  test("reports the host as off when the brain is disabled", async () => {
    await manager.applySettings({ ...DEFAULT_MUTABLE_BRAIN_CONFIG, enabled: false });
    const endpoint = manager.getProviderEndpoint();
    expect(endpoint.state).toBe("unavailable");
    expect(endpoint).toMatchObject({ reason: expect.stringContaining("turned off") });
  });

  test("reports the host as not running when it is enabled but has no child", async () => {
    await manager.applySettings({
      ...DEFAULT_MUTABLE_BRAIN_CONFIG,
      enabled: true,
      autoStart: false,
    });
    const endpoint = manager.getProviderEndpoint();
    expect(endpoint.state).toBe("unavailable");
    expect(endpoint).toMatchObject({ reason: expect.stringContaining("not running") });
  });

  test("reports a remote brain with no host configured as unavailable", async () => {
    await manager.applySettings(remoteConfig({ host: "" }));
    const endpoint = manager.getProviderEndpoint();
    expect(endpoint.state).toBe("unavailable");
    expect(endpoint).toMatchObject({ reason: expect.stringContaining("No remote") });
  });

  test("derives the remote base URL, bearer token, and TLS trust from the settings", async () => {
    await manager.applySettings(
      remoteConfig({
        host: "brain.example",
        port: 4321,
        secure: true,
        authToken: "secret-token",
        certFingerprint: TEST_CERT_FINGERPRINT,
      }),
    );

    expect(manager.getProviderEndpoint()).toMatchObject({
      state: "ready",
      baseUrl: "https://brain.example:4321/v1",
      apiKey: "secret-token",
    });
    // A pinned self-signed peer cannot be verified by the platform default, so
    // the endpoint has to carry its own dispatcher.
    const endpoint = manager.getProviderEndpoint();
    expect(endpoint.state === "ready" && endpoint.dispatcher).toBeTruthy();
  });

  test("uses the platform default transport for a plain-HTTP remote", async () => {
    await manager.applySettings(
      remoteConfig({ host: "brain.example", port: 1234, secure: false, authToken: null }),
    );

    expect(manager.getProviderEndpoint()).toEqual({
      state: "ready",
      baseUrl: "http://brain.example:1234/v1",
      apiKey: null,
      dispatcher: null,
    });
  });

  test("notifies listeners when applied settings change reachability", async () => {
    const onReachabilityChanged = vi.fn();
    const listening = new BrainManager({
      logger: createTestLogger(),
      managedProcesses: createRegistryStub(),
      ottoHome,
      onReachabilityChanged,
    });
    try {
      await listening.applySettings(remoteConfig({ host: "brain.example" }));
      expect(onReachabilityChanged).toHaveBeenCalled();
    } finally {
      await listening.shutdown();
    }
  });
});

interface EventBrainServer extends TestBrainServer {
  /** Push a snapshot to every currently subscribed daemon. */
  publish(snapshot: Record<string, unknown>): void;
  /** End every open stream, as a brain that went away would. */
  dropStreams(): void;
  streamCount(): number;
}

/**
 * A brain whose `/__host/status` advertises `capabilities.events` and whose
 * `/__host/events` is a real SSE endpoint.
 */
function startEventBrainServer(options: { events: boolean }): Promise<EventBrainServer> {
  const requests: SeenRequest[] = [];
  let streams: http.ServerResponse[] = [];
  const server = http.createServer((req, res) => {
    const token = req.headers["x-otto-brain-token"];
    requests.push({
      method: req.method,
      path: req.url,
      token: typeof token === "string" ? token : undefined,
    });
    if ((req.url ?? "").startsWith("/__host/events")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`event: status\ndata: ${JSON.stringify({ state: "stopped" })}\n\n`);
      streams.push(res);
      res.on("close", () => {
        streams = streams.filter((open) => open !== res);
      });
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ state: "ready", capabilities: { load: true, events: options.events } }),
    );
  });
  return listen(server, requests).then((base) => ({
    ...base,
    publish: (snapshot: Record<string, unknown>) => {
      for (const res of streams) {
        res.write(`event: status\ndata: ${JSON.stringify(snapshot)}\n\n`);
      }
    },
    dropStreams: () => {
      for (const res of streams.splice(0)) res.end();
    },
    streamCount: () => streams.length,
  }));
}

function hasState(published: BrainHostStatus[], state: string): boolean {
  return published.some((status) => status.state === state);
}

function hasModel(published: BrainHostStatus[], model: string): boolean {
  return published.some((status) => status.model === model);
}

function sawUnreachable(published: BrainHostStatus[]): boolean {
  return published.some((status) => status.reachable === false);
}

function sawPathPrefix(requests: SeenRequest[], prefix: string): boolean {
  return requests.some((request) => request.path?.startsWith(prefix) === true);
}

/** Wait for a condition the subscription reaches asynchronously. */
async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * The daemon subscribes to the brain's own event stream once per configured
 * brain and fans the snapshots out. These cover the compatibility decision (does
 * this brain advertise events at all?), the transport it uses, and what happens
 * when the stream dies - which is a reachability transition, not a lost socket.
 */
describe("BrainManager status event subscription", () => {
  let ottoHome: string;
  let manager: BrainManager | null;
  let brainServer: EventBrainServer | TestBrainServer | null;

  beforeEach(() => {
    ottoHome = mkdtempSync(path.join(tmpdir(), "otto-brain-events-test-"));
    manager = null;
    brainServer = null;
  });

  afterEach(async () => {
    await manager?.shutdown();
    await brainServer?.close();
    rmSync(ottoHome, { recursive: true, force: true });
  });

  function createManager(onStatusChanged: (status: BrainHostStatus) => void): BrainManager {
    const created = new BrainManager({
      logger: createTestLogger(),
      managedProcesses: createRegistryStub(),
      ottoHome,
    });
    created.setStatusListeners({ onStatusChanged, onStatusEventSupportChanged: () => {} });
    return created;
  }

  test("subscribes to a brain that advertises events and republishes its snapshots", async () => {
    const events = await startEventBrainServer({ events: true });
    brainServer = events;
    const published: BrainHostStatus[] = [];
    manager = createManager((status) => published.push(status));

    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: events.port,
        secure: false,
        authToken: "secret-token",
      }),
    );
    await until(() => events.streamCount() === 1, "the daemon to subscribe");
    expect(manager.supportsStatusEvents()).toBe(true);

    events.publish({ state: "starting", model: "a-model" });
    await until(() => hasState(published, "starting"), "the pushed snapshot");

    // The daemon's own fields are joined onto the brain's body exactly as the
    // polled read does it: a pushed snapshot must not be a smaller shape.
    expect(published.find((status) => status.state === "starting")).toMatchObject({
      state: "starting",
      model: "a-model",
      running: true,
      reachable: true,
      host: "127.0.0.1",
      port: events.port,
    });
    // One subscription per brain, never one per connected client.
    expect(events.streamCount()).toBe(1);
    expect(events.requests.every((request) => request.token === "secret-token")).toBe(true);
    expect(events.requests.some((request) => request.path === "/__host/events")).toBe(true);
  });

  test("never opens a stream against a brain that reports events: false", async () => {
    const events = await startEventBrainServer({ events: false });
    brainServer = events;
    manager = createManager(() => {});

    await manager.applySettings(
      remoteConfig({ host: "127.0.0.1", port: events.port, secure: false }),
    );
    await until(() => sawPathPrefix(events.requests, "/__host/status"), "the initial status read");
    // Give a stream attempt every chance to appear before ruling it out.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.requests.some((request) => request.path === "/__host/events")).toBe(false);
    expect(manager.supportsStatusEvents()).toBe(false);
  });

  test("walks the feature flag down as the selected brain changes", async () => {
    const events = await startEventBrainServer({ events: true });
    brainServer = events;
    const supportChanges: boolean[] = [];
    const created = new BrainManager({
      logger: createTestLogger(),
      managedProcesses: createRegistryStub(),
      ottoHome,
    });
    manager = created;
    created.setStatusListeners({
      onStatusChanged: () => {},
      onStatusEventSupportChanged: () => supportChanges.push(created.supportsStatusEvents()),
    });

    await created.applySettings(
      remoteConfig({ host: "127.0.0.1", port: events.port, secure: false }),
    );
    await until(() => created.supportsStatusEvents(), "support to be announced");
    expect(supportChanges).toEqual([true]);

    // Repointed at nothing: availability is a property of the SELECTED brain,
    // not a fixed daemon capability.
    await created.applySettings(remoteConfig({ host: "" }));
    await until(() => !created.supportsStatusEvents(), "support to be withdrawn");
    expect(supportChanges).toEqual([true, false]);
  });

  test("publishes an unreachable snapshot when the stream drops", async () => {
    const events = await startEventBrainServer({ events: true });
    brainServer = events;
    const published: BrainHostStatus[] = [];
    manager = createManager((status) => published.push(status));

    await manager.applySettings(
      remoteConfig({ host: "127.0.0.1", port: events.port, secure: false }),
    );
    await until(() => events.streamCount() === 1, "the daemon to subscribe");

    // The brain goes away entirely: streams end and nothing answers afterwards.
    events.dropStreams();
    await events.close();
    brainServer = null;

    await until(() => sawUnreachable(published), "the unreachable snapshot");
    expect(published.at(-1)).toMatchObject({ running: false, reachable: false });
  });

  test("suppresses an identical snapshot rather than waking every client", async () => {
    const events = await startEventBrainServer({ events: true });
    brainServer = events;
    const published: BrainHostStatus[] = [];
    manager = createManager((status) => published.push(status));

    await manager.applySettings(
      remoteConfig({ host: "127.0.0.1", port: events.port, secure: false }),
    );
    await until(() => events.streamCount() === 1, "the daemon to subscribe");

    events.publish({ state: "ready", model: "a-model" });
    await until(() => hasModel(published, "a-model"), "the first snapshot");
    const afterFirst = published.length;

    events.publish({ state: "ready", model: "a-model" });
    events.publish({ state: "ready", model: "a-model" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(published.length).toBe(afterFirst);
  });

  test("subscribes over the pinned TLS transport", async () => {
    const requests: SeenRequest[] = [];
    let streamOpened = false;
    const server = https.createServer({ cert: TEST_CERT, key: TEST_KEY }, (req, res) => {
      const token = req.headers["x-otto-brain-token"];
      requests.push({
        method: req.method,
        path: req.url,
        token: typeof token === "string" ? token : undefined,
      });
      if ((req.url ?? "").startsWith("/__host/events")) {
        streamOpened = true;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`event: status\ndata: ${JSON.stringify({ state: "ready" })}\n\n`);
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ state: "ready", capabilities: { events: true } }));
    });
    brainServer = await listen(server, requests);
    manager = createManager(() => {});

    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: TEST_CERT_FINGERPRINT,
      }),
    );
    await until(() => streamOpened, "the pinned stream to open");
    expect(requests.every((request) => request.token === "secret-token")).toBe(true);
  });

  test("does not reach a remote whose certificate fails its pin", async () => {
    const requests: SeenRequest[] = [];
    const server = https.createServer({ cert: TEST_CERT, key: TEST_KEY }, (req, res) => {
      requests.push({ method: req.method, path: req.url, token: undefined });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ state: "ready", capabilities: { events: true } }));
    });
    brainServer = await listen(server, requests);
    manager = createManager(() => {});

    await manager.applySettings(
      remoteConfig({
        host: "127.0.0.1",
        port: brainServer.port,
        secure: true,
        authToken: "secret-token",
        certFingerprint: WRONG_FINGERPRINT,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    // Nothing reached the HTTP layer, so nothing - the stream included - ever
    // wrote the auth token to an unauthenticated peer.
    expect(requests).toHaveLength(0);
    expect(manager.supportsStatusEvents()).toBe(false);
  });
});
