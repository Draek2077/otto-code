import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { HostEngine } from "@getpaseo/brain/host";
import { BrainConfigSchema, ProfilesStoreSchema, resolveBrainPaths } from "@getpaseo/brain/config";
import {
  BrainStatusSchema,
  BrainActionSchema,
  BrainQuerySchema,
} from "@getpaseo/protocol/otto/brain";
import { brainActionRequest, brainQueryRequest } from "./routes.js";
import {
  BrainInventorySchema,
  BrainProfileReadSchema,
} from "@getpaseo/protocol/otto/brain-library";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("the application accepts a real unloaded standalone host without probing hardware or constructing a supervisor", async () => {
  const root = mkdtempSync(
    fileURLToPath(new URL("../../../../../../.tmp/brain-contract-", import.meta.url)),
  );
  roots.push(root);
  const env = { OTTO_HOME: root };
  const model = {
    id: "fixture/model",
    displayName: "Fixture",
    modelPath: `${root}/private.gguf`,
    mmprojPath: null,
    mmprojBytes: 0,
    sizeBytes: 1,
    quant: null,
    metadata: null,
    features: { mtp: false, distilled: false, imatrix: false },
  };
  let probes = 0;
  const engine = new HostEngine(
    {
      instanceId: "isolated-owner",
      env,
      paths: resolveBrainPaths(env),
      config: BrainConfigSchema.parse({}),
    },
    {
      scan: () => [model],
      profiles: () => ProfilesStoreSchema.parse({}),
      runtime: () => null,
      ranking: () => [],
      gpu: async () => {
        probes++;
        return null;
      },
      createSupervisor: async () => {
        throw new Error("No model runtime may be created by this fixture");
      },
    },
  );
  try {
    expect(BrainStatusSchema.parse(await engine.snapshot())).toMatchObject({
      instanceId: "isolated-owner",
      running: true,
      state: "stopped",
      residents: [],
      capabilities: { events: true, logCursors: true, profiles: true },
    });
    expect(probes).toBe(0);
    const inventory = BrainInventorySchema.parse(
      await engine.inventory(new AbortController().signal),
    );
    expect(inventory.models[0]).toMatchObject({ id: model.id, budget: null });
    expect(JSON.stringify(inventory)).not.toContain("private.gguf");
    const profile = BrainProfileReadSchema.parse({
      ...engine.modelProfiles.read(model),
      requiresRestart: false,
    });
    expect(profile.fields.length).toBeGreaterThan(0);
    expect(profile.profile?.contextSize).toBeGreaterThan(0);
    expect(JSON.stringify(profile)).not.toContain("private.gguf");
  } finally {
    await engine.stop(new AbortController().signal);
  }
});
test("model identity characters stay in one encoded query value", () => {
  const modelId = "owner/repo/model?extra=1&other=2";
  const request = brainActionRequest(BrainActionSchema.parse({ action: "load", modelId }));
  const url = new URL(request.route, "http://fixture.invalid");
  expect(url.pathname).toBe("/__host/model/load");
  expect([...url.searchParams]).toEqual([["id", modelId]]);
});
test("query inputs reject an arbitrary URL or destination field", () => {
  expect(
    BrainQuerySchema.safeParse({ resource: "status", route: "https://other.invalid" }).success,
  ).toBe(false);
  expect(
    BrainActionSchema.safeParse({
      action: "install-runtime",
      runtimeId: "opaque",
      destination: "/host/path",
    }).success,
  ).toBe(false);
  expect(
    brainQueryRequest(BrainQuerySchema.parse({ resource: "quants", repo: "author/repo&next=else" }))
      .route,
  ).toBe("/__host/hf/quants?repo=author%2Frepo%26next%3Delse");
});
test("profile writes retain their exact originating revision and known action boundary", () => {
  const input = BrainActionSchema.parse({
    action: "save-profile",
    modelId: "model",
    expectedRevision: "origin",
    patch: { contextSize: 4096 },
  });
  expect(brainActionRequest(input)).toEqual({
    route: "/__host/model/profile?id=model",
    body: { expectedRevision: "origin", patch: { contextSize: 4096 } },
  });
  expect(
    BrainActionSchema.safeParse({ action: "save-profile", modelId: "model", patch: {} }).success,
  ).toBe(false);
});
