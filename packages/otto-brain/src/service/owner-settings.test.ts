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
