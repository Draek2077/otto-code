import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { once } from "node:events";
import { fixtureRoot } from "./test-fixtures.js";
import { Supervisor, type SupervisorOptions } from "./src/service/supervisor.js";
import { resolveBrainPaths } from "./src/config/paths.js";
import { ProfilesStoreSchema } from "./src/config/schema.js";
import { defaultProfile } from "./src/config/profiles.js";
import { llamaCppRuntimeDriver } from "./src/runtime/model-server-driver.js";
import type { Model, Runtime } from "./src/types.js";

export async function createSupervisorFixture(
  mode = "ready",
  timeout = 5000,
  probes: Pick<SupervisorOptions, "readUsedBytes"> = {},
) {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-model-child-"));
  const paths = resolveBrainPaths({ OTTO_HOME: root });
  const script = path.join(root, "fixture.mjs");
  fs.writeFileSync(
    script,
    `
    import http from 'node:http';
    const args = process.argv.slice(2);
    const mode = ${JSON.stringify(mode)};
    if (mode === 'exit') process.exit(23);
    if (mode === 'logs') process.stdout.write('Metal KV buffer size = 1.00 MiB');
    const port = Number(args[args.indexOf('--port') + 1]);
    const server = http.createServer((req, res) => {
      if (req.url === '/health') { res.writeHead(mode === 'loading' ? 503 : 200); res.end('{}'); }
      else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ args, path: process.env.PATH })); }
    });
    server.listen(port, '127.0.0.1');
    if (mode === 'crash') process.on('message', () => process.exit(24));
  `,
  );
  const socket = net.createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("fixture port not bound");
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const model: Model = {
    id: "fixture/model/test-Q4_K_M.gguf",
    displayName: "Fixture model",
    modelPath: path.join(root, "test.gguf"),
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q4_K_M",
    sizeBytes: 24,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: { contextLength: 2048 },
  };
  const runtime: Runtime = {
    label: "Fixture llama.cpp",
    version: "b10265",
    exe: process.execPath,
    dir: root,
    vendorDir: null,
    source: "managed",
  };
  const supervisor = new Supervisor({
    ...probes,
    runtime,
    paths,
    internalPort: address.port,
    readyTimeoutMs: timeout,
    getProfilesStore: () => ProfilesStoreSchema.parse({}),
    driver: {
      ...llamaCppRuntimeDriver,
      createLaunch(input) {
        const launch = llamaCppRuntimeDriver.createLaunch(input);
        return { ...launch, args: [script, ...launch.args] };
      },
    },
  });
  return { root, paths, model, runtime, supervisor, profile: defaultProfile(model) };
}
