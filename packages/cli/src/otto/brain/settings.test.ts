import { afterEach, expect, it, vi } from "vitest";
import { Command } from "commander";
import { BrainConfigSchema } from "@getpaseo/brain/config";
import { BrainOwnerReadSchema, BrainConnectionReadSchema } from "@getpaseo/protocol/otto/brain";
import { daemonBrainSettings } from "./settings.js";
const transport = vi.hoisted(() => ({ connect: vi.fn(), close: vi.fn() }));
vi.mock("../../utils/client.js", () => ({ connectToDaemon: transport.connect }));
import { createOttoBrainCommand } from "./commands.js";

afterEach(() => {
  vi.restoreAllMocks();
  transport.connect.mockReset();
  transport.close.mockReset();
});
function fixture() {
  const config = BrainConfigSchema.parse({
    modelsDir: "/owner/models",
    runtime: { path: "/owner/pinned" },
  });
  const owner = BrainOwnerReadSchema.parse({
    version: 1,
    ownerId: "actual-owner",
    ownerLabel: "Owner",
    revision: "owner-origin",
    config: {
      ...config,
      auth: { mode: "none" },
      runtime: { ...config.runtime, selectionId: "opaque-installed" },
    },
    credentials: {
      access: { stored: true, effectiveSource: "stored" },
      huggingFace: { stored: true, effectiveSource: "stored" },
    },
    resolved: {
      runtimeLabel: "Owner runtime",
      executablePath: "/owner/pinned",
      modelsDirectory: "/owner/models",
      certificateDirectory: null,
    },
    choices: { models: [], runtimes: [], cacheTypes: [] },
    requiresRestart: false,
    capabilities: {
      networkDiscovery: true,
      sharing: true,
      runtimeSelection: true,
      storage: true,
      accessCredential: true,
      huggingFaceCredential: true,
    },
  });
  const connection = BrainConnectionReadSchema.parse({
    version: 1,
    revision: "connection-origin",
    config: {
      enabled: false,
      autoStart: true,
      mode: "remote",
      remote: { host: "remote.invalid", port: 1234, secure: true, certFingerprint: "pinned" },
    },
    credential: { stored: true, effectiveSource: "stored" },
  });
  const invoke = vi.fn(
    async (_plugin: string, method: string, input: unknown): Promise<unknown> => {
      if (method === "brain.bootstrap")
        return {
          ok: true,
          value: { connection, owner, ownerError: null, localRunning: false, endpoint: null },
        };
      if (method === "brain.connection.read") return { ok: true, value: connection };
      if (method === "brain.connection.save")
        return { ok: true, value: { ...connection, revision: "connection-saved" } };
      if (method === "brain.owner.save")
        return { ok: true, value: { ...owner, revision: "owner-saved" } };
      if (method === "brain.owner.share")
        return {
          ok: true,
          value: {
            owner: { ...owner, revision: "owner-saved", requiresRestart: true },
            secret: "new-owner-generated-key",
          },
        };
      throw new Error(`Unexpected settings fixture method ${method}: ${JSON.stringify(input)}`);
    },
  );
  const client = {
    getLastServerInfoMessage: () => ({ features: { ottoBrain: true, ottoBrainSharing: true } }),
    invokePluginRpc: invoke,
    close: transport.close.mockResolvedValue(undefined),
  };
  return { owner, connection, invoke, client, target: daemonBrainSettings(client) };
}

it("keeps connection edits independent of an unreachable owner and never admits a runtime", async () => {
  const f = fixture();
  f.invoke.mockImplementation(async (_plugin, method) => {
    if (method === "brain.connection.read") return { ok: true, value: f.connection };
    if (method === "brain.connection.save")
      return { ok: true, value: { ...f.connection, revision: "accepted" } };
    throw new Error("Must not inspect or start an owner");
  });
  const saved = await f.target.setConfig("enabled", "false");
  expect(saved).toMatchObject({ connection: { revision: "accepted" } });
  expect(f.invoke.mock.calls.map((call) => call[1])).toEqual([
    "brain.connection.read",
    "brain.connection.save",
  ]);
  expect(f.invoke).toHaveBeenLastCalledWith("otto-brain", "brain.connection.save", {
    expectedRevision: "connection-origin",
    patch: { enabled: false },
    credential: { action: "keep" },
  });
});

it("runs shared CLI sharing through owner CAS and returns only a newly generated direct-result key", async () => {
  const f = fixture();
  transport.connect.mockResolvedValue(f.client);
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const cli = new Command("otto").option("--host <host>").addCommand(createOttoBrainCommand());
  await cli.parseAsync(
    ["brain", "share", "--host", "selected.example:6788", "--bind", "all", "--generate", "--json"],
    { from: "user" },
  );
  expect(f.invoke).toHaveBeenLastCalledWith("otto-brain", "brain.owner.share", {
    ownerId: "actual-owner",
    expectedRevision: "owner-origin",
    options: { bind: "all", generate: true },
  });
  expect(output).toHaveBeenCalledWith(expect.stringContaining("new-owner-generated-key"));
  expect(output).toHaveBeenCalledWith(expect.stringContaining('"requiresRestart": true'));
  expect(transport.close).toHaveBeenCalledOnce();
  expect(JSON.stringify(await f.target.readConfig())).not.toContain("new-owner-generated-key");
});

it("keeps sharing reads passive and requires the actual owner capability before mutations", async () => {
  const f = fixture();
  expect(await f.target.share({})).toMatchObject({ key: null, hasKey: true });
  expect(f.invoke.mock.calls.map((call) => call[1])).toEqual(["brain.bootstrap"]);
  f.owner.capabilities.sharing = false;
  f.invoke.mockClear();
  await expect(f.target.share({ generate: true })).rejects.toMatchObject({
    code: "DAEMON_UPDATE_REQUIRED",
  });
  expect(f.invoke.mock.calls.map((call) => call[1])).toEqual(["brain.bootstrap"]);
});

it("uses owner CAS and only the edited leaf, never redacted credentials from its projection", async () => {
  const f = fixture();
  expect(await f.target.readConfig()).toMatchObject({
    enabled: false,
    autoStart: true,
    auth: { token: "********" },
    hfToken: "********",
  });
  await f.target.setConfig("defaults.parallelSlots", "3");
  expect(f.invoke).toHaveBeenLastCalledWith("otto-brain", "brain.owner.save", {
    ownerId: "actual-owner",
    expectedRevision: "owner-origin",
    patch: { defaults: { parallelSlots: 3 } },
  });
  await f.target.setConfig("hfToken", "new-private-key");
  expect(f.invoke).toHaveBeenLastCalledWith("otto-brain", "brain.owner.save", {
    ownerId: "actual-owner",
    expectedRevision: "owner-origin",
    patch: {},
    credentials: { huggingFace: { action: "replace", value: "new-private-key" } },
  });
  await f.target.setConfig("hfToken", "null");
  expect(f.invoke).toHaveBeenLastCalledWith("otto-brain", "brain.owner.save", {
    ownerId: "actual-owner",
    expectedRevision: "owner-origin",
    patch: {},
    credentials: { huggingFace: { action: "remove" } },
  });
  expect(JSON.stringify(await f.target.readConfig())).not.toContain("new-private-key");
});

it("keeps owner paths exact and clears selection identities atomically for runtime policy edits", async () => {
  const f = fixture();
  await f.target.setConfig("runtime.source", "lmstudio");
  expect(f.invoke).toHaveBeenLastCalledWith("otto-brain", "brain.owner.save", {
    ownerId: "actual-owner",
    expectedRevision: "owner-origin",
    patch: { runtime: { source: "lmstudio", path: null, selectionId: null } },
  });
  await f.target.setConfig("modelsDir", "/other-owner/models");
  expect(f.invoke).toHaveBeenLastCalledWith("otto-brain", "brain.owner.save", {
    ownerId: "actual-owner",
    expectedRevision: "owner-origin",
    patch: { modelsDir: "/other-owner/models" },
  });
});

it("refuses a changed connection and does not rebase or retry a rejected owner write", async () => {
  const f = fixture();
  const implementation = f.invoke.getMockImplementation()!;
  f.invoke.mockImplementation(async (plugin, method, input) =>
    method === "brain.connection.read"
      ? { ok: true, value: { ...f.connection, revision: "peer-change" } }
      : implementation(plugin, method, input),
  );
  await expect(f.target.setConfig("lockModel", "true")).rejects.toMatchObject({
    code: "BRAIN_CONFLICT",
  });
  expect(f.invoke.mock.calls.some((call) => call[1] === "brain.owner.save")).toBe(false);
  f.invoke.mockClear();
  f.invoke.mockImplementation(async (plugin, method, input) =>
    method === "brain.owner.save"
      ? { ok: false, error: { kind: "conflict", message: "private-host-detail" } }
      : implementation(plugin, method, input),
  );
  await expect(f.target.setConfig("lockModel", "true")).rejects.toMatchObject({
    code: "BRAIN_CONFLICT",
  });
  expect(f.invoke.mock.calls.filter((call) => call[1] === "brain.owner.save")).toHaveLength(1);
});

it("runs the shared Root CLI settings handler on a disabled selected daemon without command admission", async () => {
  const f = fixture();
  transport.connect.mockResolvedValue(f.client);
  const output = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const cli = () =>
    new Command("otto").option("--host <host>").addCommand(createOttoBrainCommand());
  await cli().parseAsync(
    ["brain", "config", "show", "--host", "selected.example:6788", "--format", "yaml"],
    { from: "user" },
  );
  expect(output).toHaveBeenCalledWith(expect.stringContaining("modelsDir: /owner/models"));
  await cli().parseAsync(
    ["brain", "config", "set", "enabled", "false", "--host", "selected.example:6788", "--quiet"],
    { from: "user" },
  );
  expect(transport.connect).toHaveBeenCalledWith({
    target: { kind: "endpoint", host: "selected.example:6788" },
  });
  expect(f.invoke.mock.calls.map((call) => call[1])).toEqual([
    "brain.bootstrap",
    "brain.connection.read",
    "brain.connection.save",
  ]);
  expect(transport.close).toHaveBeenCalledTimes(2);
});
