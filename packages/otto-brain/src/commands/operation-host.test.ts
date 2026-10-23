import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { BrainConfigSchema } from "../config/schema.js";
import { readPidFile } from "../service/pid-lock.js";
import { localBrainRequest } from "../service/local-client.js";
import { startService, type ServiceHandle } from "../service/serve.js";
import { withOperationHost, completeOwnedOperation } from "./operation-host.js";

const roots: string[] = [];
const services: ServiceHandle[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(fixtureRoot(), "brain-cli-operation-"));
  roots.push(root);
  return { OTTO_HOME: root };
}

it("reuses an existing owner without replacing or stopping it", async () => {
  const env = fixture();
  const host = await startService({
    env,
    config: BrainConfigSchema.parse({ listen: { port: 0 } }),
  });
  services.push(host);
  const before = readPidFile(env);
  const result = await withOperationHost((client) => localBrainRequest(client, "/health"), { env });
  expect(result).toEqual({ status: "ok" });
  expect(readPidFile(env)).toEqual(before);
  expect(host.server.listening).toBe(true);
});

it("releases only its temporary service even if the command fails", async () => {
  const env = fixture();
  const failure = new Error("fixture command failed");
  await expect(
    withOperationHost(
      async (client) => {
        expect(client.record.host).toBe("127.0.0.1");
        expect(client.record.port).toBeGreaterThan(0);
        expect(await localBrainRequest(client, "/health")).toEqual({ status: "ok" });
        throw failure;
      },
      {
        env,
        createRuntime: () => ({
          status: () => ({ state: "stopped", model: null, modelId: null }),
          handleRequest: () => false,
          stop: async () => {},
        }),
      },
    ),
  ).rejects.toBe(failure);
  expect(readPidFile(env)).toBeNull();
});

it("preserves both command and shutdown errors with the command as primary cause", async () => {
  const primary = new Error("fixture command");
  const cleanup = new Error("fixture shutdown");
  await expect(
    completeOwnedOperation(
      async () => {
        throw primary;
      },
      async () => {
        throw cleanup;
      },
    ),
  ).rejects.toMatchObject({ errors: [primary, cleanup], cause: primary });
});
