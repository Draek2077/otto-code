/** Real daemon-to-owner transport with the existing synthetic Node model engine. CI only. */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { HostEngine, ServiceHandle } from "@getpaseo/brain/host";
import { BrainConnectionReadSchema, BrainStatusSchema } from "@getpaseo/protocol/otto/brain";
import {
  BrainInventorySchema,
  BrainProfileReadSchema,
  BrainJobListSchema,
} from "@getpaseo/protocol/otto/brain-library";
import { test as base, expect, requestBrain } from "./otto-brain";
import { connectDaemonClient } from "./daemon-client-loader";

type Client = Pick<DaemonClient, "connect" | "close" | "invokePluginRpc">;
// Like daemon-client-loader, use file URLs to keep the built ESM graph outside
// Playwright's CommonJS TypeScript transform. All classes share one module graph.
async function loadBrainModules() {
  const root = path.resolve(__dirname, "../../../../otto-brain");
  const url = (file: string) => pathToFileURL(path.join(root, file)).href;
  const config: typeof import("@getpaseo/brain/config") = await import(url("dist/config/index.js"));
  const host: typeof import("@getpaseo/brain/host") = await import(url("dist/host.js"));
  const core: typeof import("@getpaseo/brain") = await import(url("dist/index.js"));
  const runtime: typeof import("@getpaseo/brain/runtime") = await import(
    url("dist/runtime/index.js")
  );
  const models: typeof import("@getpaseo/brain/models") = await import(url("dist/models/index.js"));
  const script: typeof import("../../../../otto-brain/test-engine-script.mjs") = await import(
    url("test-engine-script.mjs")
  );
  return { ...config, ...host, Supervisor: core.Supervisor, ...runtime, ...models, ...script };
}
function fixtureRoot(): string {
  const parent = path.resolve(__dirname, "../../../../../.tmp");
  fs.mkdirSync(parent, { recursive: true });
  return parent;
}
async function createOwnerEngineFixture(brain: Awaited<ReturnType<typeof loadBrainModules>>) {
  const {
    resolveBrainPaths,
    engineFixtureSource,
    Supervisor,
    loadProfilesStore,
    llamaCppRuntimeDriver,
  } = brain;
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-ui-owner-"));
  const paths = resolveBrainPaths({
    ...process.env,
    OTTO_HOME: root,
    PASEO_HOME: root,
    NODE_ENV: "test",
  });
  const script = path.join(root, "fixture.mjs");
  fs.writeFileSync(script, engineFixtureSource());
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string")
    throw new Error("Synthetic internal port was not bound");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const runtime = {
    label: "Synthetic Node engine",
    version: "b10265",
    exe: process.execPath,
    dir: root,
    vendorDir: null,
    source: "managed" as const,
  };
  const supervisor = new Supervisor({
    runtime,
    paths,
    internalPort: address.port,
    readyTimeoutMs: 5000,
    getProfilesStore: () => loadProfilesStore(paths),
    readUsedBytes: async () => null,
    driver: {
      ...llamaCppRuntimeDriver,
      createLaunch(input) {
        const launch = llamaCppRuntimeDriver.createLaunch(input);
        return { ...launch, args: [script, ...launch.args] };
      },
    },
  });
  return { root, paths, runtime, supervisor };
}
function removeOwnedFixture(root: string): void {
  const relative = path.relative(fixtureRoot(), root);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Unexpected fixture cleanup path");
  fs.rmSync(root, { recursive: true, force: true });
}
interface BrainOwnerFixture {
  modelId: string;
  modelName: string;
  profileContext(): Promise<number>;
  inventory(): Promise<ReturnType<typeof BrainInventorySchema.parse>>;
  status(): Promise<ReturnType<typeof BrainStatusSchema.parse>>;
  jobs(): Promise<ReturnType<typeof BrainJobListSchema.parse>>;
}
export const test = base.extend<{ brainOwner: BrainOwnerFixture }>({
  brainOwner: async ({ brain }, provide) => {
    void brain;
    const modules = await loadBrainModules();
    const {
      BrainConfigSchema,
      updateBrainConfig,
      readBrainConfigRevision,
      startService,
      HostEngine,
      scanModels,
    } = modules;
    const fixture = await createOwnerEngineFixture(modules);
    let service: ServiceHandle | null = null;
    let client: Client | null = null;
    let original: ReturnType<typeof BrainConnectionReadSchema.parse> | null = null;
    try {
      const directory = path.join(fixture.paths.modelsDir, "e2e", "brain-fixture");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "weights-Q4_K_M.gguf"), Buffer.alloc(24));
      fs.appendFileSync(
        path.join(fixture.root, "fixture.mjs"),
        "\nprocess.stdout.write('brain-e2e-ready\\n');\n",
      );
      const env = { OTTO_HOME: fixture.root, PASEO_HOME: fixture.root, NODE_ENV: "test" as const };
      const config = BrainConfigSchema.parse({
        listen: { port: 0 },
        allowRemoteConfig: true,
        modelsDir: fixture.paths.modelsDir,
      });
      updateBrainConfig(
        readBrainConfigRevision(fixture.paths).revision,
        () => config,
        fixture.paths,
      );
      let engine!: HostEngine;
      service = await startService({
        config,
        env,
        createRuntime: (context) =>
          (engine = new HostEngine(context, {
            scan: (options) =>
              scanModels(config, env, {
                ...options,
                dirs: [{ dir: fixture.paths.modelsDir, origin: "managed" }],
              }),
            runtime: () => fixture.runtime,
            runtimeList: () => [fixture.runtime],
            createSupervisor: async () => fixture.supervisor,
            gpu: async () => null,
            readUsedBytes: async () => null,
          })),
      });
      const model = engine.models()[0];
      if (!model) throw new Error("Synthetic owner model was not discovered");
      const profile = engine.modelProfiles.read(model);
      engine.modelProfiles.save(model, { contextSize: 16384 }, profile.revision);
      client = await connectDaemonClient<Client>({ clientIdPrefix: "otto-brain-operational" });
      const boundClient = client;
      original = BrainConnectionReadSchema.parse(
        await requestBrain(client, "brain.connection.read", {}),
      );
      await requestBrain(client, "brain.connection.save", {
        expectedRevision: original.revision,
        patch: {
          enabled: true,
          autoStart: false,
          mode: "remote",
          remote: {
            host: "127.0.0.1",
            port: service.port,
            secure: false,
            certFingerprint: null,
          },
        },
        credential: { action: "keep" },
      });
      await provide({
        modelId: model.id,
        modelName: model.displayName,
        profileContext: async () => {
          const loadedProfile = BrainProfileReadSchema.parse(
            await requestBrain(boundClient, "brain.query", {
              resource: "profile",
              modelId: model.id,
            }),
          ).profile;
          if (!loadedProfile) throw new Error("Synthetic model profile is unavailable");
          return loadedProfile.contextSize;
        },
        inventory: async () =>
          BrainInventorySchema.parse(
            await requestBrain(boundClient, "brain.query", { resource: "inventory" }),
          ),
        status: async () =>
          BrainStatusSchema.parse(
            await requestBrain(boundClient, "brain.query", { resource: "status" }),
          ),
        jobs: async () =>
          BrainJobListSchema.parse(
            await requestBrain(boundClient, "brain.query", { resource: "jobs" }),
          ),
      });
    } finally {
      try {
        if (client && original) {
          const current = BrainConnectionReadSchema.parse(
            await requestBrain(client, "brain.connection.read", {}),
          );
          await requestBrain(client, "brain.connection.save", {
            expectedRevision: current.revision,
            patch: original.config,
            credential: { action: "keep" },
          });
        }
      } finally {
        try {
          await client?.close();
        } finally {
          try {
            await service?.stop();
          } finally {
            removeOwnedFixture(fixture.root);
          }
        }
      }
    }
  },
});
export { expect };
