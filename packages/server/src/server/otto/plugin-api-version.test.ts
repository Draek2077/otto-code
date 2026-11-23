import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { OTTO_PASEO_BASE_VERSION } from "@getpaseo/protocol/otto/identity";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

async function withPluginHost(
  options: Parameters<typeof createTestPaseoDaemon>[0],
  check: (client: DaemonClient, directory: string) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), "otto-plugin-version-"));
  try {
    await writeFile(
      path.join(directory, "paseo-plugin.json"),
      JSON.stringify({
        id: "version-example",
        requirements: { paseo: "^99.0.0" },
      }),
    );
    await writeFile(path.join(directory, "index.client.ts"), "export default () => () => {};");
    const daemon = await createTestPaseoDaemon({
      ...options,
      pluginsEnabled: true,
      mcpEnabled: false,
    });
    try {
      const client = new DaemonClient({
        url: `ws://127.0.0.1:${daemon.port}/ws`,
        clientId: "otto-plugin-api-version",
        reconnect: { enabled: false },
      });
      try {
        await client.connect();
        await client.fetchAgents();
        await check(client, directory);
      } finally {
        await client.close();
      }
    } finally {
      await daemon.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

it("checks plugin compatibility against the Paseo base while reporting Otto's product version", async () => {
  await withPluginHost({ daemonVersion: "99.0.0" }, async (client, directory) => {
    expect(client.getLastServerInfoMessage()?.version).toBe("99.0.0");
    await expect(client.installDirectoryPlugin(directory)).rejects.toThrow(
      `Your daemon is ${OTTO_PASEO_BASE_VERSION}`,
    );
  });
}, 30_000);

it("lets a versioned host simulate a different plugin API independently of its product version", async () => {
  await withPluginHost(
    { daemonVersion: "0.10.0", pluginApiVersion: "99.0.0" },
    async (client, directory) => {
      expect(client.getLastServerInfoMessage()?.version).toBe("0.10.0");
      await expect(client.installDirectoryPlugin(directory)).resolves.toMatchObject({
        id: "version-example",
      });
    },
  );
}, 30_000);
