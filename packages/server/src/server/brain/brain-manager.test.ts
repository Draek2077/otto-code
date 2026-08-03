import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type { MutableBrainConfig } from "@otto-code/protocol/messages";
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
});
