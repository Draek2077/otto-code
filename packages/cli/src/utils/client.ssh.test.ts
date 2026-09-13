import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSshFailureDetail } from "../ssh/ssh-tunnel.js";
import { connectToDaemon, getExplicitDaemonHost } from "./client.js";

const mocks = vi.hoisted(() => ({
  configs: [] as Array<Record<string, unknown>>,
  createSshTunnel: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@otto-code/client/internal/daemon-client", () => ({
  DaemonClient: class {
    lastError = null;

    constructor(config: Record<string, unknown>) {
      mocks.configs.push(config);
    }

    async connect() {
      await mocks.connect();
    }
    async close() {}
  },
}));

vi.mock("../ssh/ssh-tunnel.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ssh/ssh-tunnel.js")>()),
  createSshTunnel: mocks.createSshTunnel,
}));
vi.mock("./client-id.js", () => ({ getOrCreateCliClientId: async () => "cli-test-id" }));

describe("CLI SSH transport", () => {
  beforeEach(() => {
    mocks.configs.length = 0;
    mocks.createSshTunnel.mockReset();
    mocks.connect.mockReset();
    mocks.createSshTunnel.mockResolvedValue({
      endpoint: "127.0.0.1:4567",
      close: vi.fn(),
      failureDetail: () => null,
    });
  });

  it("surfaces SSH stderr before the child exit event settles", () => {
    expect(resolveSshFailureDetail(null, "Host key verification failed.\n")).toBe(
      "Host key verification failed.",
    );
    expect(resolveSshFailureDetail("ssh exited with code 255", "earlier stderr")).toBe(
      "ssh exited with code 255",
    );
  });

  it("routes an SSH host through a local tunnel", async () => {
    await connectToDaemon({ host: "ssh://deploy@build-box:2222?daemonPort=7777" });

    expect(mocks.createSshTunnel).toHaveBeenCalledWith({
      host: "deploy@build-box",
      sshPort: 2222,
      daemonPort: 7777,
    });
    expect(mocks.configs[0]).toMatchObject({
      url: "ws://127.0.0.1:4567/ws",
      clientId: "cli-test-id",
      clientType: "cli",
    });
  });

  it("uses Otto's host environment and lets an explicit host override it", () => {
    expect(getExplicitDaemonHost(undefined, { OTTO_HOST: "ssh://deploy@build-box" })).toBe(
      "ssh://deploy@build-box",
    );
    expect(getExplicitDaemonHost("explicit:7777", { OTTO_HOST: "other:7777" })).toBe(
      "explicit:7777",
    );
    expect(getExplicitDaemonHost(undefined, { OTTO_HOST: " " })).toBeUndefined();
  });

  it("closes a failed SSH tunnel and surfaces its failure instead of suggesting a local restart", async () => {
    const close = vi.fn();
    mocks.createSshTunnel.mockResolvedValue({
      endpoint: "127.0.0.1:4567",
      close,
      failureDetail: () => "Host key verification failed.",
    });
    mocks.connect.mockRejectedValue(new Error("socket closed"));

    await expect(connectToDaemon({ host: "ssh://deploy@build-box" })).rejects.toThrow(
      "SSH connection failed: Host key verification failed.",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
});
