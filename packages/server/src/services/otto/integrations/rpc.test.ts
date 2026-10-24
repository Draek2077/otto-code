import { expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  readAtlassianAccount,
  saveAtlassianAccount,
} from "@getpaseo/plugin/otto/atlassian-settings";
import { compilePlugin } from "../../../server/plugins/compiler.js";
import { evaluateBundle } from "../../../server/plugins/bundle-evaluator.js";
import { IntegrationAccountRpc } from "./rpc.js";
import { AtlassianAccountService } from "../atlassian/account.js";

it("compiles the actual managed integration entries with callable eager setup", async () => {
  const directory = fileURLToPath(
    new URL("../../../../../../plugins/otto-integrations/", import.meta.url),
  );
  const bundles = await compilePlugin({
    server: path.join(directory, "index.server.ts"),
    client: path.join(directory, "index.client.tsx"),
  });
  if (!bundles.serverBundle) throw new Error("Shared integration server entry did not compile");
  expect(typeof evaluateBundle(bundles.serverBundle)).toBe("function");
  expect(bundles.clientBundle).toContain("@getpaseo/plugin/otto/atlassian-settings");
});
function fixture() {
  let reads = 0;
  const service = new AtlassianAccountService({
    hostId: "host",
    legacy: async () => {
      reads++;
      return {
        gitHosting: {
          providers: {
            atlassian: { email: "person@example.test", apiToken: "private-preserved-token" },
          },
        },
      };
    },
    registry: {
      read: async () => ({ revision: "first", connections: {} }),
      update: async () => {
        throw new Error("Not used");
      },
    },
    vault: async () => {
      throw new Error("Do not open keyring for reads");
    },
  });
  return { rpc: new IntegrationAccountRpc("host", service), reads: () => reads };
}
it("returns only sanitized account status and never resolves an existing secret to the renderer", async () => {
  const f = fixture();
  const result = await f.rpc.invoke(readAtlassianAccount.name, { hostId: "host" });
  expect(result).toMatchObject({
    ok: true,
    value: { credential: { source: "preserved", stored: true } },
  });
  expect(JSON.stringify(result)).not.toContain("private-preserved-token");
  expect(f.rpc.invoke("integrations.atlassian.arbitrary", {})).toBeUndefined();
});
it("rejects the wrong host and wire-supplied credential metadata before effects", async () => {
  const f = fixture();
  expect(await f.rpc.invoke(readAtlassianAccount.name, { hostId: "other" })).toMatchObject({
    ok: false,
    error: { kind: "validation" },
  });
  expect(f.reads()).toBe(0);
  await expect(
    f.rpc.invoke(saveAtlassianAccount.name, {
      hostId: "host",
      expectedRevision: "first",
      config: {
        email: "person@example.test",
        siteUrl: "fixture",
        route: { kind: "site" },
        credentialId: "injected",
      },
      credential: { kind: "keep" },
    }),
  ).rejects.toThrow();
  expect(f.reads()).toBe(0);
});
