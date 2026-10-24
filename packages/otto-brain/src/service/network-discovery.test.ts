import path from "node:path";
import { expect, test, vi } from "vitest";
import { BrainConfigSchema } from "../config/schema.js";
import { resolveBrainPaths } from "../config/paths.js";
import { discoverBrainNetwork, type BrainNetworkPorts } from "./network-discovery.js";

function fixture() {
  const paths = resolveBrainPaths({ OTTO_HOME: path.resolve(".tmp/never-created-network-owner") });
  const config = BrainConfigSchema.parse({ tls: { tailscaleExe: "/owner/tailscale" } });
  const ports: BrainNetworkPorts = {
    addresses: vi.fn(() => [
      { address: "127.0.0.1", label: "Local" },
      { address: "127.0.0.1", label: "Duplicate" },
      { address: "100.64.0.4", label: "Tailnet" },
    ]),
    tailscale: vi.fn(async () => ({
      BackendState: "Running",
      Self: { DNSName: "actual-owner.tailnet.ts.net." },
      privateOtherState: "not-returned",
    })),
  };
  return { paths, config, ports };
}
test("returns only the actual owner's addresses and connected Tailscale identity", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const value = await discoverBrainNetwork("actual-owner", f.config, f.paths, signal, f.ports);
  expect(value).toEqual({
    ownerId: "actual-owner",
    addresses: [
      { id: "127.0.0.1", label: "Local" },
      { id: "100.64.0.4", label: "Tailnet" },
    ],
    tailscale: {
      available: true,
      hostname: "actual-owner.tailnet.ts.net",
      certificateDirectory: path.join(f.paths.root, "certs"),
    },
  });
  expect(f.ports.tailscale).toHaveBeenCalledWith("/owner/tailscale", signal);
  expect(JSON.stringify(value)).not.toContain("not-returned");
});
test("retains the owner's explicit certificate directory without creating it", async () => {
  const f = fixture();
  f.config.tls.certDir = "/actual-owner/certificates";
  expect(
    (await discoverBrainNetwork("owner", f.config, f.paths, new AbortController().signal, f.ports))
      .tailscale.certificateDirectory,
  ).toBe("/actual-owner/certificates");
});
test.each([
  { BackendState: "Stopped", Self: { DNSName: "old.ts.net" } },
  { Self: { DNSName: "unknown.ts.net" } },
  { bad: true },
])(
  "does not claim unavailable or malformed Tailscale state is connected (%j)",
  async (response) => {
    const f = fixture();
    f.ports.tailscale = async () => response;
    expect(
      (
        await discoverBrainNetwork(
          "owner",
          f.config,
          f.paths,
          new AbortController().signal,
          f.ports,
        )
      ).tailscale,
    ).toEqual({ available: false, hostname: null, certificateDirectory: null });
  },
);
test("a failed CLI probe returns availability only, without native error text", async () => {
  const f = fixture();
  f.ports.tailscale = async () => {
    throw new Error("untrusted native diagnostic");
  };
  const value = await discoverBrainNetwork(
    "owner",
    f.config,
    f.paths,
    new AbortController().signal,
    f.ports,
  );
  expect(value.tailscale.available).toBe(false);
  expect(JSON.stringify(value)).not.toContain("untrusted native diagnostic");
});
test("cancellation before discovery performs no address or CLI operation", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  await expect(
    discoverBrainNetwork("owner", f.config, f.paths, controller.signal, f.ports),
  ).rejects.toThrow();
  expect(f.ports.addresses).not.toHaveBeenCalled();
  expect(f.ports.tailscale).not.toHaveBeenCalled();
});
test("cancellation during the CLI probe remains cancellation rather than an unavailable result", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.ports.tailscale = async () => {
    controller.abort();
    throw new Error("probe canceled");
  };
  await expect(
    discoverBrainNetwork("owner", f.config, f.paths, controller.signal, f.ports),
  ).rejects.toThrow();
});
