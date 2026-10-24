import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixtureRoot } from "../../test-fixtures.js";
import { BrainConfigSchema } from "../config/schema.js";
import { readBrainConfigRevision, updateBrainConfig } from "../config/revision-store.js";
import { resolveBrainPaths } from "../config/paths.js";
import type { Runtime } from "../types.js";
import { BrainOwnerSettings } from "./owner-settings.js";
import { runtimeIdentity } from "./runtime-management.js";

const roots: string[] = [];

it("saves sharing and a freshly generated key in one owner revision without touching other settings", async () => {
  const f = fixture();
  const origin = f.settings.read();
  const result = await f.settings.share(
    {
      ownerId: origin.ownerId,
      expectedRevision: origin.revision,
      options: { bind: "all", generate: true, allowConfig: true, https: "self-signed" },
    },
    AbortSignal.timeout(3000),
  );
  expect(result.secret).toMatch(/^[A-Za-z0-9_-]{32}$/u);
  expect(result.owner).toMatchObject({
    requiresRestart: true,
    config: {
      listen: { host: "0.0.0.0" },
      auth: { mode: "token" },
      allowInsecureBind: false,
      allowRemoteConfig: true,
      tls: { mode: "self-signed" },
    },
  });
  expect(JSON.stringify(result.owner)).not.toContain(result.secret);
  const saved = readBrainConfigRevision(f.paths).config;
  expect(saved.auth.token).toBe(result.secret);
  expect(saved.hfToken).toBe("fixture-stored-hf");
  expect(saved.enabled).toBe(false);
  expect(f.notifications()).toBe(1);
  expect(fs.existsSync(f.paths.pidFile)).toBe(false);
});

it("rejects a peer sharing write after planning instead of rebasing the original revision", async () => {
  const f = fixture();
  const origin = f.settings.read();
  const pending = f.settings.share(
    { ownerId: origin.ownerId, expectedRevision: origin.revision, options: { off: true } },
    AbortSignal.timeout(3000),
  );
  const rejected = expect(pending).rejects.toMatchObject({ kind: "conflict" });
  updateBrainConfig(origin.revision, (config) => ({ ...config, maxLoadedModels: 4 }), f.paths);
  await rejected;
  expect(readBrainConfigRevision(f.paths).config).toMatchObject({
    maxLoadedModels: 4,
    auth: { mode: "token", token: "fixture-stored-access" },
  });
  expect(f.notifications()).toBe(0);
});

it("preserves environment-owned sharing credentials and refuses explicit rotation without modifying stored bytes", async () => {
  const f = fixture({ OTTO_BRAIN_TOKEN: "fixture-environment-access" });
  const origin = f.settings.read();
  const result = await f.settings.share(
    {
      ownerId: origin.ownerId,
      expectedRevision: origin.revision,
      options: { bind: "all", access: "key" },
    },
    AbortSignal.timeout(3000),
  );
  expect(result.secret).toBe(null);
  expect(result.owner.credentials.access.effectiveSource).toBe("environment");
  const before = fs.readFileSync(f.paths.configFile, "utf8");
  await expect(
    f.settings.share(
      {
        ownerId: result.owner.ownerId,
        expectedRevision: result.owner.revision,
        options: { generate: true },
      },
      AbortSignal.timeout(3000),
    ),
  ).rejects.toMatchObject({ kind: "validation" });
  expect(fs.readFileSync(f.paths.configFile, "utf8")).toBe(before);
});

it("reads sharing without writes and rejects redacted replacement keys", async () => {
  const f = fixture();
  const origin = f.settings.read();
  const before = fs.readFileSync(f.paths.configFile, "utf8");
  const result = await f.settings.share(
    { ownerId: origin.ownerId, expectedRevision: origin.revision, options: {} },
    AbortSignal.timeout(3000),
  );
  expect(result.secret).toBe(null);
  expect(result.owner.revision).toBe(origin.revision);
  await expect(
    f.settings.share(
      { ownerId: origin.ownerId, expectedRevision: origin.revision, options: { key: "********" } },
      AbortSignal.timeout(3000),
    ),
  ).rejects.toMatchObject({ kind: "validation" });
  expect(fs.readFileSync(f.paths.configFile, "utf8")).toBe(before);
});
afterEach(() => {
  for (const root of roots.splice(0)) {
    const relative = path.relative(fixtureRoot(), root);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Unexpected fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture(env: NodeJS.ProcessEnv = {}) {
  const root = fs.mkdtempSync(path.join(fixtureRoot(), "brain-owner-settings-"));
  roots.push(root);
  const paths = resolveBrainPaths({ OTTO_HOME: root });
  const config = BrainConfigSchema.parse({
    hfToken: "fixture-stored-hf",
    auth: { mode: "token", token: "fixture-stored-access" },
  });
  updateBrainConfig(readBrainConfigRevision(paths).revision, () => config, paths);
  const runtimes: Runtime[] = ["managed", "lmstudio"].map((source) => ({
    label: source,
    source: source === "managed" ? "managed" : "lmstudio",
    version: "fixture",
    dir: path.join(root, source),
    exe: path.join(root, source, "llama-server"),
    vendorDir: null,
  }));
  let notifications = 0;
  const context = {
    paths,
    env: { OTTO_HOME: root, ...env },
    instanceId: "first-host-instance",
    config: structuredClone(config),
  };
  const ports = {
    runtimes: () => runtimes,
    resolve: () => null,
    changed: () => {
      notifications++;
    },
    label: "Fixture owner",
    models: () => [{ id: "model/opaque-id", label: "My model" }],
  };
  const settings = new BrainOwnerSettings(context, ports);
  const request = (patch: object = {}, credentials?: object) => {
    const read = settings.read();
    return {
      ownerId: read.ownerId,
      expectedRevision: read.revision,
      patch,
      ...(credentials ? { credentials } : {}),
    };
  };
  return {
    root,
    paths,
    context,
    ports,
    settings,
    runtimes,
    request,
    notifications: () => notifications,
  };
}

it("returns sanitized owner settings and a stable owner independent of process lifetime", () => {
  const f = fixture();
  const read = f.settings.read();
  expect(JSON.stringify(read)).not.toContain("fixture-stored-");
  expect(read.credentials.access).toEqual({ stored: true, effectiveSource: "stored" });
  expect(read.requiresRestart).toBe(false);
  const other = new BrainOwnerSettings(
    { ...f.context, instanceId: "second-host-instance" },
    f.ports,
  );
  expect(other.ownerId).toBe(read.ownerId);
  expect(fs.existsSync(f.paths.pidFile)).toBe(false);
  expect(read.resolved.modelsDirectory).toBe(f.paths.modelsDir);
  expect(read.resolved.certificateDirectory).toBeNull();
  expect(read.choices.models).toEqual([{ id: "model/opaque-id", label: "My model" }]);
  expect(read.choices.runtimes[0]!.id).toBe(runtimeIdentity(f.runtimes[0]!));
  expect(read.choices.runtimes[0]!.id).not.toContain(f.root);
});
it("reads a cheap peer revision without scanning models and leaves malformed peer settings intact", () => {
  const f = fixture();
  f.ports.models = () => {
    throw new Error("Revision checks must not scan models");
  };
  expect(f.settings.revision()).toBe(readBrainConfigRevision(f.paths).revision);
  fs.writeFileSync(f.paths.configFile, "{ damaged peer edit");
  expect(f.settings.revision()).toBeNull();
  expect(fs.readFileSync(f.paths.configFile, "utf8")).toBe("{ damaged peer edit");
});

it("saves partial owner fields against the origin without mutating active host configuration", () => {
  const f = fixture();
  const saved = f.settings.save(
    f.request({ defaults: { contextCap: 32000 }, runtime: { logVerbosity: 4 } }),
  );
  expect(saved.config.defaults).toMatchObject({ contextCap: 32000, parallelSlots: 1 });
  expect(saved.config.runtime.logVerbosity).toBe(4);
  expect(saved.requiresRestart).toBe(true);
  expect(f.context.config.defaults.contextCap).toBe(225000);
  expect(f.context.config.runtime.logVerbosity).toBe(3);
  expect(readBrainConfigRevision(f.paths).config).toMatchObject({
    hfToken: "fixture-stored-hf",
    auth: { token: "fixture-stored-access" },
  });
  expect(f.notifications()).toBe(1);
});

it("rejects peer and wrong-owner writes without adopting their revisions", () => {
  const f = fixture();
  const request = f.request({ maxLoadedModels: 3 });
  f.settings.save(f.request({ defaultModel: "peer-model" }));
  expect(() => f.settings.save(request)).toThrow(expect.objectContaining({ kind: "conflict" }));
  expect(() => f.settings.save({ ...f.request(), ownerId: "different-owner" })).toThrow(
    expect.objectContaining({ kind: "conflict" }),
  );
  expect(readBrainConfigRevision(f.paths).config.maxLoadedModels).toBe(1);
});

it("resolves an opaque LM Studio selection on the host instead of trusting a client source", () => {
  const f = fixture();
  const runtime = f.runtimes[1]!;
  const saved = f.settings.save(
    f.request({
      runtime: { selectionId: runtimeIdentity(runtime), source: "managed", path: null },
    }),
  );
  expect(saved.config.runtime).toMatchObject({
    source: "lmstudio",
    path: runtime.exe,
    selectionId: runtimeIdentity(runtime),
  });
});

it("permits an explicit owner path while clearing a previous opaque selection", () => {
  const f = fixture();
  f.settings.save(f.request({ runtime: { selectionId: runtimeIdentity(f.runtimes[0]!) } }));
  const saved = f.settings.save(
    f.request({ runtime: { selectionId: null, path: "/actual-owner/custom-executable" } }),
  );
  expect(saved.config.runtime).toMatchObject({
    selectionId: null,
    path: "/actual-owner/custom-executable",
  });
});

it("clears an installed selection through explicit automatic policy", () => {
  const f = fixture();
  f.settings.save(f.request({ runtime: { selectionId: runtimeIdentity(f.runtimes[0]!) } }));
  const saved = f.settings.save(
    f.request({ runtime: { selectionId: null, source: "auto", path: null } }),
  );
  expect(saved.config.runtime).toMatchObject({ source: "auto", path: null, selectionId: null });
});

it.each([
  { runtime: { selectionId: "unknown-runtime" } },
  { runtime: { selectionId: "runtime/fake", path: "/unrelated/path" } },
  { enabled: true },
  { auth: { token: "not-an-intent" } },
  { hfToken: "not-an-intent" },
  { listen: { port: 0 } },
  { defaults: { parallelSlots: 0 } },
  { lockModel: true, lockedModels: ["a", "b"] },
  { tls: { mode: "files" } },
])("rejects invalid owner edits before persistence: %j", (patch) => {
  const f = fixture();
  const bytes = fs.readFileSync(f.paths.configFile, "utf8");
  expect(() => f.settings.save(f.request(patch))).toThrow(
    expect.objectContaining({ kind: "validation" }),
  );
  expect(fs.readFileSync(f.paths.configFile, "utf8")).toBe(bytes);
  expect(f.notifications()).toBe(0);
});

it("keeps credentials unless an explicit replacement or removal intent is supplied", () => {
  const f = fixture();
  f.settings.save(f.request({}, { huggingFace: { action: "replace", value: "fixture-new-hf" } }));
  expect(readBrainConfigRevision(f.paths).config.hfToken).toBe("fixture-new-hf");
  f.settings.save(f.request({}, { huggingFace: { action: "remove" } }));
  expect(f.settings.read().credentials.huggingFace).toEqual({
    stored: false,
    effectiveSource: "none",
  });
  expect(readBrainConfigRevision(f.paths).config.auth.token).toBe("fixture-stored-access");
});

it.each(["", " ", "unsafe\nvalue"])(
  "rejects invalid credential text without treating it as removal: %j",
  (value) => {
    const f = fixture();
    expect(() =>
      f.settings.save(f.request({}, { huggingFace: { action: "replace", value } })),
    ).toThrow(expect.objectContaining({ kind: "validation" }));
    expect(readBrainConfigRevision(f.paths).config.hfToken).toBe("fixture-stored-hf");
  },
);

it("reports environment ownership and prevents ineffective credential, runtime or storage changes", () => {
  const f = fixture({
    OTTO_BRAIN_TOKEN: "fixture-env-access",
    HF_TOKEN: "fixture-env-hf",
    OTTO_BRAIN_LLAMA_SERVER: "/env/runtime",
    OTTO_BRAIN_MODELS_DIR: "/env/models",
  });
  expect(f.settings.read().capabilities).toEqual({
    networkDiscovery: true,
    runtimeSelection: false,
    storage: false,
    accessCredential: false,
    huggingFaceCredential: false,
  });
  expect(f.settings.read().credentials.access.effectiveSource).toBe("environment");
  for (const request of [
    f.request({ runtime: { path: "/elsewhere" } }),
    f.request({ modelsDir: "/elsewhere" }),
    f.request({}, { access: { action: "remove" } }),
    f.request({}, { huggingFace: { action: "remove" } }),
  ])
    expect(() => f.settings.save(request)).toThrow(expect.objectContaining({ kind: "validation" }));
  expect(JSON.stringify(f.settings.read())).not.toContain("fixture-env-");
});

it("returns a new generated key only in its direct result and stages it for explicit restart", () => {
  const f = fixture();
  const { ownerId, revision: expectedRevision } = f.settings.read();
  const generated = f.settings.generateAccessKey({ ownerId, expectedRevision });
  expect(generated.secret).toHaveLength(32);
  expect(generated.owner.requiresRestart).toBe(true);
  expect(readBrainConfigRevision(f.paths).config.auth.token).toBe(generated.secret);
  expect(JSON.stringify(generated.owner)).not.toContain(generated.secret);
  expect(JSON.stringify(f.settings.read())).not.toContain(generated.secret);
  expect(f.context.config.auth.token).toBe("fixture-stored-access");
});

it("does not remove an environment-owned key or persist a generated ineffective replacement", () => {
  const f = fixture({ OTTO_BRAIN_TOKEN: "fixture-env-access" });
  const { ownerId, revision: expectedRevision } = f.settings.read();
  expect(() => f.settings.generateAccessKey({ ownerId, expectedRevision })).toThrow(
    expect.objectContaining({ kind: "validation" }),
  );
  expect(readBrainConfigRevision(f.paths).config.auth.token).toBe("fixture-stored-access");
});

it("classifies a busy claim conservatively without replacing or deleting it", () => {
  const f = fixture();
  fs.writeFileSync(`${f.paths.configFile}.lock`, "external-claim");
  expect(() => f.settings.save(f.request())).toThrow(
    expect.objectContaining({ kind: "unavailable" }),
  );
  expect(fs.readFileSync(`${f.paths.configFile}.lock`, "utf8")).toBe("external-claim");
});
