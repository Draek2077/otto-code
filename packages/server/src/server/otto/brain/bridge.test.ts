import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { z } from "zod";
import { startService, HostEngine } from "@getpaseo/brain/host";
import {
  BrainConfigSchema,
  ProfilesStoreSchema,
  readBrainConfigRevision,
  resolveBrainPaths,
} from "@getpaseo/brain/config";
import {
  BrainBootstrapSchema,
  BrainOperationResultSchema,
  BrainStatusReadSchema,
  BrainOwnerReadSchema,
} from "@getpaseo/protocol/otto/brain";
import { BrainInventorySchema } from "@getpaseo/protocol/otto/brain-library";
import { BrainDaemonService } from "./service.js";
import { compilePlugin } from "../../plugins/compiler.js";

function value(response: unknown): unknown {
  const result = BrainOperationResultSchema.parse(response);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
test("the actual daemon bridge reaches a remote unloaded host without starting a model or changing its client home", async () => {
  const parent = fileURLToPath(new URL("../../../../../../.tmp/", import.meta.url));
  const root = mkdtempSync(path.join(parent, "brain-bridge-"));
  const relative = path.relative(parent, root);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Unexpected fixture cleanup path");
  let constructions = 0;
  const host = await startService({
    env: { OTTO_HOME: path.join(root, "owner") },
    config: BrainConfigSchema.parse({ listen: { port: 0 }, allowRemoteConfig: true }),
    createRuntime: (context) =>
      new HostEngine(context, {
        scan: () => [],
        profiles: () => ProfilesStoreSchema.parse({}),
        runtime: () => null,
        runtimeList: () => [],
        gpu: async () => null,
        results: () => [],
        createSupervisor: async () => {
          constructions++;
          throw new Error("No model may be launched by this fixture");
        },
      }),
  });
  const proxyHome = path.join(root, "proxy");
  const connectionPath = path.join(root, "otto-config.json");
  writeFileSync(
    connectionPath,
    JSON.stringify({
      brain: {
        enabled: true,
        autoStart: false,
        mode: "remote",
        remote: { host: "127.0.0.1", port: host.port, secure: false },
      },
    }),
  );
  const bridge = new BrainDaemonService(root, { OTTO_HOME: proxyHome });
  try {
    const bootstrap = BrainBootstrapSchema.parse(
      value(await bridge.invoke("brain.bootstrap", {}, "fixture-session")),
    );
    expect(bootstrap).toMatchObject({
      localRunning: false,
      ownerError: null,
      connection: { config: { mode: "remote" } },
    });
    expect(bootstrap.owner?.resolved.modelsDirectory).toContain(path.join("owner", "otto-brain"));
    const inventory = BrainInventorySchema.parse(
      value(await bridge.invoke("brain.query", { resource: "inventory" }, "fixture-session")),
    );
    expect(inventory.models).toEqual([]);
    const initial = BrainStatusReadSchema.parse(
      value(
        await bridge.invoke(
          "brain.status.wait",
          {
            leaseId: "00000000-0000-4000-8000-000000000001",
            cursor: null,
            includeLogs: false,
            afterLogIndex: null,
            instanceId: null,
          },
          "fixture-session",
        ),
      ),
    );
    let snapshot = initial;
    for (let index = 0; index < 4 && snapshot.connection !== "connected"; index++)
      snapshot = BrainStatusReadSchema.parse(
        value(
          await bridge.invoke(
            "brain.status.wait",
            {
              leaseId: "00000000-0000-4000-8000-000000000001",
              cursor: snapshot.cursor,
              includeLogs: false,
              afterLogIndex: null,
              instanceId: null,
            },
            "fixture-session",
          ),
        ),
      );
    expect(snapshot).toMatchObject({
      connection: "connected",
      logs: [],
      status: { running: true, residents: [], jobs: [] },
    });
    const commandOrigin = {
      connectionRevision: bootstrap.connection.revision,
      instanceId: snapshot.status?.instanceId,
      requestId: "00000000-0000-4000-8000-000000000002",
      request: { operation: "inventory" },
    };
    const commandInventory = value(
      await bridge.invoke("brain.cli.request", commandOrigin, "fixture-session"),
    );
    expect(commandInventory).toMatchObject({ models: [] });
    expect(
      await bridge.invoke(
        "brain.cli.request",
        {
          ...commandOrigin,
          connectionRevision: "peer-changed-connection",
        },
        "fixture-session",
      ),
    ).toMatchObject({ ok: false, error: { kind: "conflict" } });
    expect(
      await bridge.invoke(
        "brain.cli.request",
        {
          ...commandOrigin,
          instanceId: "old-owner-lifetime",
        },
        "fixture-session",
      ),
    ).toMatchObject({ ok: false, error: { kind: "conflict" } });
    expect(
      await bridge.invoke(
        "brain.cli.request",
        {
          ...commandOrigin,
          request: { operation: "inventory", route: "/__host/settings" },
        },
        "fixture-session",
      ),
    ).toMatchObject({ ok: false, error: { kind: "validation" } });
    const owner = bootstrap.owner;
    if (!owner) throw new Error("Fixture owner missing");
    const saved = BrainOwnerReadSchema.parse(
      value(
        await bridge.invoke(
          "brain.owner.save",
          {
            ownerId: owner.ownerId,
            expectedRevision: owner.revision,
            patch: { runtime: { logVerbosity: 4 } },
            credentials: { access: { action: "keep" }, huggingFace: { action: "keep" } },
          },
          "fixture-session",
        ),
      ),
    );
    expect(saved.config.runtime.logVerbosity).toBe(4);
    expect(saved.requiresRestart).toBe(true);
    const shared = z.object({ owner: BrainOwnerReadSchema, secret: z.string() }).parse(
      value(
        await bridge.invoke(
          "brain.owner.share",
          {
            ownerId: saved.ownerId,
            expectedRevision: saved.revision,
            options: { bind: "all", generate: true, allowConfig: true },
          },
          "fixture-session",
        ),
      ),
    );
    expect(shared.owner.config.listen.host).toBe("0.0.0.0");
    expect(shared.owner.config.runtime.logVerbosity).toBe(4);
    expect(shared.owner.requiresRestart).toBe(true);
    expect(JSON.stringify(shared.owner)).not.toContain(shared.secret);
    expect(
      readBrainConfigRevision(resolveBrainPaths({ OTTO_HOME: path.join(root, "owner") })).config
        .auth.token,
    ).toBe(shared.secret);
    const afterSharing = BrainBootstrapSchema.parse(
      value(await bridge.invoke("brain.bootstrap", {}, "fixture-session")),
    );
    expect(JSON.stringify(afterSharing)).not.toContain(shared.secret);
    expect(afterSharing.connection.revision).toBe(bootstrap.connection.revision);
    expect(constructions).toBe(0);
    bridge.releaseClient("fixture-session");
  } finally {
    await bridge.close();
    await host.stop();
    rmSync(root, { recursive: true, force: true });
  }
});
test("the actual built-in Brain contribution compiles its client-only renderer bridge", async () => {
  const directory = fileURLToPath(
    new URL("../../../../../../plugins/otto-brain/", import.meta.url),
  );
  const bundle = await compilePlugin({
    server: path.join(directory, "index.server.ts"),
    client: path.join(directory, "index.client.tsx"),
  });
  expect(bundle.clientBundle).toContain("@getpaseo/plugin/client/otto-brain");
  expect(bundle.clientBundle).toContain("addSidebarFooterItem");
  expect(bundle.clientBundle).toContain("addSettingsScreen");
  expect(bundle.serverBundle).toBeTruthy();
});
