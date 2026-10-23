import { describe, expect, it } from "vitest";
import type {
  BrainConnectionRead,
  BrainOwnerRead,
  BrainSettingsPort,
  BrainSettingsSnapshot,
} from "./contracts";
import { BrainSettingsOperationError } from "./contracts";
import { openBrainSettingsForm } from "./form-model";

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Uninitialized fixture reply");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Uninitialized fixture reply");
  };
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function connection(): BrainConnectionRead {
  return {
    version: 1,
    revision: "connection/opaque-A",
    credential: { stored: true, effectiveSource: "stored" },
    config: {
      enabled: false,
      autoStart: true,
      mode: "local",
      remote: {
        host: "brain.fixture",
        port: 1234,
        secure: true,
        certFingerprint: " AA:BB ",
      },
    },
  };
}

function owner(): BrainOwnerRead {
  return {
    version: 1,
    owner: { id: "actual-owner", label: "Fixture owner", route: "owning-daemon" },
    revision: "owner/opaque-A",
    config: {
      runtime: {
        source: "lmstudio",
        selectionId: null,
        executablePath: " D:\\Owner\\llama-server.exe ",
        logVerbosity: 2,
      },
      storage: { modelsDirectory: "D:\\Owner\\Models" },
      defaults: {
        cacheTypeK: "q8_0",
        cacheTypeV: "f16",
        flashAttention: true,
        reasoningBudget: 768,
        parallelSlots: 2,
        contextCap: 32000,
      },
      residency: {
        defaultModelId: "model-a",
        maxLoadedModels: 2,
        lockModel: false,
        lockedModelIds: [],
      },
      access: {
        listenHost: "127.0.0.1",
        listenPort: 1234,
        authMode: "token",
        allowRemoteConfig: false,
        allowInsecureBind: false,
      },
      tls: {
        mode: "files",
        certFile: "D:\\Owner\\cert.pem",
        keyFile: "D:\\Owner\\key.pem",
        hostname: "owner.fixture",
        certDirectory: "D:\\Owner\\Certs",
        renewBeforeDays: 21,
        checkIntervalMs: 43200000,
        tailscaleExecutable: null,
      },
    },
    credentials: {
      access: { stored: true, effectiveSource: "stored" },
      huggingFace: { stored: true, effectiveSource: "environment" },
    },
    resolved: {
      runtimeLabel: "Owner runtime",
      executablePath: "D:\\Owner\\llama-server.exe",
      modelsDirectory: "D:\\Owner\\Models",
      totalBytes: 1000,
      freeBytes: 300,
      certificateDirectory: "D:\\Owner\\Certs",
    },
    requiresRestart: false,
  };
}

function snapshot(): BrainSettingsSnapshot {
  return {
    version: 1,
    host: { serverId: "selected-daemon", label: "Selected host", connected: true },
    connection: { state: "ready", data: connection() },
    owner: { state: "ready", data: owner() },
    status: {
      phase: "stopped",
      version: "fixture",
      endpoint: "https://owner.fixture:1234",
      modelLabel: null,
      message: null,
    },
    capabilities: {
      supported: {
        runtime: true,
        storage: true,
        defaults: true,
        residency: true,
        access: true,
        tls: true,
        logging: true,
      },
      editConnection: true,
      remoteConnection: true,
      runtime: true,
      storage: true,
      defaults: true,
      residency: true,
      access: true,
      tls: true,
      logging: true,
      remoteCredential: true,
      accessCredential: true,
      huggingFaceCredential: true,
      discoverNetwork: true,
      generateAccessKey: true,
      lifecycle: { start: true, stop: false, restart: false },
    },
    choices: {
      models: [{ id: "model-a", label: "Model A" }],
      runtimes: [{ id: "installed-a", label: "Installed A" }],
      cacheTypes: [
        { id: "f16", label: "f16" },
        { id: "q8_0", label: "q8_0" },
      ],
      bindAddresses: [{ id: "127.0.0.1", label: "Local only" }],
    },
  };
}

function fixture(initial = snapshot()) {
  let current = initial;
  let demands = 0;
  let releases = 0;
  const listeners = new Set<() => void>();
  const connections: Array<{
    input: Parameters<BrainSettingsPort["saveConnection"]>[0];
    reply: ReturnType<typeof deferred<BrainConnectionRead>>;
  }> = [];
  const owners: Array<{
    input: Parameters<BrainSettingsPort["saveOwner"]>[0];
    reply: ReturnType<typeof deferred<BrainOwnerRead>>;
  }> = [];
  const generations: Array<{
    input: Parameters<BrainSettingsPort["generateAccessKey"]>[0];
    reply: ReturnType<typeof deferred<{ owner: BrainOwnerRead; secret: string }>>;
  }> = [];
  const connectionReads: Array<ReturnType<typeof deferred<BrainConnectionRead>>> = [];
  const ownerReads: Array<{ ownerId: string; reply: ReturnType<typeof deferred<BrainOwnerRead>> }> =
    [];
  const actions: Array<Parameters<BrainSettingsPort["performOwnerAction"]>[0]> = [];
  const port: BrainSettingsPort = {
    version: 1,
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    retainSettings: () => {
      demands++;
      return () => {
        releases++;
      };
    },
    readConnection: () => {
      const reply = deferred<BrainConnectionRead>();
      connectionReads.push(reply);
      return reply.promise;
    },
    readOwner: (ownerId) => {
      const reply = deferred<BrainOwnerRead>();
      ownerReads.push({ ownerId, reply });
      return reply.promise;
    },
    saveConnection: (input) => {
      const reply = deferred<BrainConnectionRead>();
      connections.push({ input, reply });
      return reply.promise;
    },
    saveOwner: (input) => {
      const reply = deferred<BrainOwnerRead>();
      owners.push({ input, reply });
      return reply.promise;
    },
    generateAccessKey: (input) => {
      const reply = deferred<{ owner: BrainOwnerRead; secret: string }>();
      generations.push({ input, reply });
      return reply.promise;
    },
    performOwnerAction: (input) => {
      actions.push(input);
      return Promise.resolve();
    },
    discoverNetwork: (ownerId) =>
      Promise.resolve({
        ownerId,
        addresses: [],
        tailscale: { available: false, hostname: null, certificateDirectory: null },
      }),
    openBrain: () => {},
  };
  const model = openBrainSettingsForm(port);
  const activate = () => model.activate();
  const hide = activate();
  const apply = (next: BrainSettingsSnapshot) => {
    current = next;
    model.applySnapshot(next);
    for (const listener of listeners) listener();
  };
  return {
    model,
    port,
    connections,
    owners,
    generations,
    connectionReads,
    ownerReads,
    actions,
    hide,
    activate,
    apply,
    demands: () => ({ demands, releases }),
  };
}

describe("Brain settings ownership and explicit saves", () => {
  it("opens with host-provided values and independent enable/autostart intent without launching or saving", async () => {
    const f = fixture();
    await Promise.resolve();
    expect(f.model.getState().connection?.draft).toMatchObject({ enabled: false, autoStart: true });
    expect(f.model.getState().owner?.draft).toMatchObject({
      runtimeSource: "lmstudio",
      logVerbosity: 2,
      reasoningBudget: "768",
      modelsDirectory: "D:\\Owner\\Models",
    });
    expect(f.connections).toEqual([]);
    expect(f.owners).toEqual([]);
    expect(f.actions).toEqual([]);
    expect(f.connectionReads).toEqual([]);
    expect(f.ownerReads).toEqual([]);
    f.hide();
    f.activate();
    f.model.close();
    expect(f.demands()).toEqual({ demands: 2, releases: 2 });
  });

  it.each([true, false])(
    "saves autostart=%s without enabling Brain or altering untouched remote configuration",
    async (autoStart) => {
      const initial = snapshot();
      const saved = connection();
      saved.config.autoStart = !autoStart;
      initial.connection = { state: "ready", data: saved };
      const f = fixture(initial);
      f.model.editConnection("autoStart", autoStart);
      const saving = f.model.saveConnection();
      expect(f.connections[0].input).toEqual({
        expectedRevision: "connection/opaque-A",
        patch: { autoStart },
        credential: { action: "keep" },
      });
      const result = connection();
      result.revision = "connection/B";
      result.config.autoStart = autoStart;
      f.connections[0].reply.resolve(result);
      expect(await saving).toBe(true);
      expect(f.actions).toEqual([]);
      expect(f.model.getState().connection?.draft.enabled).toBe(false);
    },
  );

  it("preserves exact owner paths and unrelated advanced fields in an explicit preference save", async () => {
    const f = fixture();
    f.model.editOwner("logVerbosity", 4);
    const saving = f.model.saveOwner();
    expect(f.owners[0].input).toEqual({
      ownerId: "actual-owner",
      expectedRevision: "owner/opaque-A",
      patch: { runtime: { logVerbosity: 4 } },
      credentials: { access: { action: "keep" }, huggingFace: { action: "keep" } },
    });
    const result = owner();
    result.revision = "owner/B";
    result.config.runtime.logVerbosity = 4;
    result.requiresRestart = true;
    f.owners[0].reply.resolve(result);
    expect(await saving).toBe(true);
    expect(f.model.getState().owner?.draft.runtimePath).toBe(" D:\\Owner\\llama-server.exe ");
    expect(f.actions).toEqual([]);
  });

  it("serializes both revision domains and keeps each draft's own opaque revision", async () => {
    const f = fixture();
    f.model.editConnection("enabled", true);
    f.model.editOwner("contextCap", "48000");
    const connectionSave = f.model.saveConnection();
    expect(await f.model.saveOwner()).toBe(false);
    expect(f.owners).toEqual([]);
    const result = connection();
    result.revision = "connection/new";
    result.config.enabled = true;
    f.connections[0].reply.resolve(result);
    await connectionSave;
    const ownerSave = f.model.saveOwner();
    expect(f.owners[0].input.expectedRevision).toBe("owner/opaque-A");
    const accepted = owner();
    accepted.config.defaults.contextCap = 48000;
    f.owners[0].reply.resolve(accepted);
    await ownerSave;
  });

  it("merges normalized acknowledgments while retaining newer field and credential edits", async () => {
    const f = fixture();
    f.model.editOwner("contextCap", "99000");
    f.model.editCredential("huggingFace", { action: "replace", value: "first-private-value" });
    const saving = f.model.saveOwner();
    f.model.editOwner("contextCap", "120000");
    f.model.editCredential("huggingFace", { action: "replace", value: "newer-private-value" });
    const result = owner();
    result.revision = "owner/normalized";
    result.config.defaults.contextCap = 96000;
    f.owners[0].reply.resolve(result);
    await saving;
    expect(f.model.getState()).toMatchObject({
      ownerDirty: true,
      owner: { origin: { revision: "owner/normalized" }, draft: { contextCap: "120000" } },
      credentials: { huggingFace: { action: "replace", value: "newer-private-value" } },
    });
    expect(f.owners).toHaveLength(1);
    const nextSave = f.model.saveOwner();
    expect(f.owners[1].input.expectedRevision).toBe("owner/normalized");
    expect(f.owners[1].input.credentials.huggingFace).toEqual({
      action: "replace",
      value: "newer-private-value",
    });
    const final = owner();
    final.config.defaults.contextCap = 120000;
    final.revision = "owner/final";
    f.owners[1].reply.resolve(final);
    await nextSave;
  });

  it("retains a selected model label when live choices disappear", () => {
    const f = fixture();
    f.model.selectModel({ id: "model-b", label: "Chosen model B" });
    const next = snapshot();
    next.choices.models = [];
    f.apply(next);
    expect(f.model.getState().displays.defaultModel).toEqual({
      id: "model-b",
      label: "Chosen model B",
    });
    expect(f.model.getState().owner?.draft.defaultModelId).toBe("model-b");
  });

  it("validates process limits without silently truncating the existing locked set", async () => {
    const f = fixture();
    f.model.selectLockedModel(0, { id: "model-a", label: "Model A" });
    f.model.selectLockedModel(1, { id: "model-b", label: "Model B" });
    f.model.editOwner("lockModel", true);
    f.model.editOwner("maxLoadedModels", "1");
    expect(await f.model.saveOwner()).toBe(false);
    expect(f.model.getState().ownerErrors.lockedModelIds).toBe(
      "The locked set exceeds the model process limit",
    );
    expect(f.model.getState().owner?.draft.lockedModelIds).toEqual(["model-a", "model-b"]);
    expect(f.owners).toEqual([]);
  });

  it("uses installed identities preferentially while preserving an explicit owning-host path option", async () => {
    const f = fixture();
    f.model.selectRuntime({ id: "installed-a", label: "Installed A" });
    expect(f.model.getState().owner?.draft).toMatchObject({
      runtimeSelectionId: "installed-a",
      runtimePath: "",
      runtimeSource: "lmstudio",
    });
    f.model.selectRuntimeSource("managed");
    f.model.setRuntimePath("/actual-owner/custom/llama-server");
    const saving = f.model.saveOwner();
    expect(f.owners[0].input.patch.runtime).toMatchObject({
      executablePath: "/actual-owner/custom/llama-server",
      source: "managed",
    });
    expect(f.model.getState().owner?.draft.runtimeSelectionId).toBe(null);
    const result = owner();
    result.config.runtime.source = "managed";
    result.config.runtime.executablePath = "/actual-owner/custom/llama-server";
    f.owners[0].reply.resolve(result);
    await saving;
  });

  it("sends an opaque LM Studio installed identity without inventing its source and adopts the owner's resolution", async () => {
    const initial = snapshot();
    const saved = owner();
    saved.config.runtime.source = "auto";
    initial.owner = { state: "ready", data: saved };
    const f = fixture(initial);
    const choice = { id: "opaque-installed-42", label: "LM Studio fixture runtime" };
    f.model.selectRuntime(choice);
    expect(f.model.getState().owner?.draft).toMatchObject({
      runtimeSelectionId: choice.id,
      runtimeSource: "auto",
      runtimePath: "",
    });
    const next = snapshot();
    next.choices.runtimes = [];
    f.apply(next);
    expect(f.model.getState().displays.runtime).toEqual(choice);
    const saving = f.model.saveOwner();
    expect(f.owners[0].input.expectedRevision).toBe("owner/opaque-A");
    expect(f.owners[0].input.patch.runtime).toEqual({
      selectionId: choice.id,
      executablePath: null,
    });
    const accepted = owner();
    accepted.revision = "owner/resolved-lmstudio";
    accepted.config.runtime.selectionId = choice.id;
    accepted.config.runtime.executablePath = null;
    f.owners[0].reply.resolve(accepted);
    expect(await saving).toBe(true);
    expect(f.model.getState().owner?.draft.runtimeSource).toBe("lmstudio");
    expect(f.model.getState().displays.runtime).toEqual(choice);
    expect(f.model.getState().ownerDirty).toBe(false);
    expect(f.actions).toEqual([]);
  });

  it("selects Automatic by explicitly clearing the saved runtime identity and executable override", async () => {
    const initial = snapshot();
    const saved = owner();
    saved.config.runtime.selectionId = "opaque-installed-42";
    initial.owner = { state: "ready", data: saved };
    const f = fixture(initial);
    f.model.selectRuntime(null);
    expect(f.model.getState().owner?.draft).toMatchObject({
      runtimeSource: "auto",
      runtimeSelectionId: null,
      runtimePath: "",
    });
    expect(f.model.getState().displays.runtime).toBe(null);
    const saving = f.model.saveOwner();
    expect(f.owners[0].input.patch.runtime).toEqual({
      source: "auto",
      selectionId: null,
      executablePath: null,
    });
    const accepted = owner();
    accepted.config.runtime.source = "auto";
    accepted.config.runtime.executablePath = null;
    f.owners[0].reply.resolve(accepted);
    expect(await saving).toBe(true);
    expect(f.model.getState().ownerDirty).toBe(false);
    expect(f.actions).toEqual([]);
  });

  it.each(["installed", "path"] as const)(
    "an explicit source policy replaces a previous %s selection",
    async (selection) => {
      const f = fixture();
      if (selection === "installed")
        f.model.selectRuntime({ id: "opaque-installed-42", label: "Captured runtime" });
      else f.model.setRuntimePath("/actual-owner/custom/llama-server");
      f.model.selectRuntimeSource("managed");
      expect(f.model.getState().owner?.draft).toMatchObject({
        runtimeSource: "managed",
        runtimeSelectionId: null,
        runtimePath: "",
      });
      expect(f.model.getState().displays.runtime).toBe(null);
      const saving = f.model.saveOwner();
      expect(f.owners[0].input.patch.runtime).toEqual({ source: "managed", executablePath: null });
      const accepted = owner();
      accepted.config.runtime.source = "managed";
      accepted.config.runtime.executablePath = null;
      f.owners[0].reply.resolve(accepted);
      expect(await saving).toBe(true);
      expect(f.model.getState().ownerDirty).toBe(false);
    },
  );

  it("preserves a newer explicit source choice through normalized acknowledgment and saves against the acknowledged revision", async () => {
    const f = fixture();
    f.model.selectRuntime({ id: "opaque-installed-42", label: "Captured runtime" });
    const saving = f.model.saveOwner();
    // The policy text equals its submitted value, but explicitly removes the pin.
    f.model.selectRuntimeSource("lmstudio");
    const accepted = owner();
    accepted.revision = "owner/normalized-runtime";
    accepted.config.runtime.source = "managed";
    accepted.config.runtime.selectionId = "opaque-installed-42";
    accepted.config.runtime.executablePath = null;
    f.owners[0].reply.resolve(accepted);
    expect(await saving).toBe(true);
    expect(f.model.getState().owner?.draft).toMatchObject({
      runtimeSource: "lmstudio",
      runtimeSelectionId: null,
      runtimePath: "",
    });
    expect(f.model.getState().displays.runtime).toBe(null);
    expect(f.model.getState().ownerDirty).toBe(true);
    expect(f.owners).toHaveLength(1);
    const nextSave = f.model.saveOwner();
    expect(f.owners[1].input.expectedRevision).toBe("owner/normalized-runtime");
    expect(f.owners[1].input.patch.runtime).toEqual({ source: "lmstudio", selectionId: null });
    const final = owner();
    final.revision = "owner/final-runtime";
    final.config.runtime.executablePath = null;
    f.owners[1].reply.resolve(final);
    expect(await nextSave).toBe(true);
    expect(f.model.getState().ownerDirty).toBe(false);
  });

  it("keeps invalid numeric input visible without sending a partial setting or launching anything", async () => {
    const f = fixture();
    f.model.editOwner("maxLoadedModels", "2oops");
    expect(await f.model.saveOwner()).toBe(false);
    expect(f.model.getState().owner?.draft.maxLoadedModels).toBe("2oops");
    expect(f.model.getState().ownerErrors.maxLoadedModels).toBe("Enter a whole number");
    expect(f.owners).toEqual([]);
    expect(f.actions).toEqual([]);
  });

  it("takes late initial data once, without reconstructing an edited domain on later snapshots", () => {
    const initial = snapshot();
    initial.owner = { state: "loading", data: null };
    const f = fixture(initial);
    expect(f.model.getState().owner).toBe(null);
    f.apply(snapshot());
    f.model.editOwner("contextCap", "48000");
    const next = snapshot();
    const peer = owner();
    peer.revision = "peer/after-initial";
    next.owner = { state: "ready", data: peer };
    f.apply(next);
    expect(f.model.getState().owner).toMatchObject({
      peerChanged: true,
      draft: { contextCap: "48000" },
      origin: { revision: "owner/opaque-A" },
    });
  });

  it("keeps a draft local when the owner's write capability is revoked", async () => {
    const f = fixture();
    f.model.editOwner("modelsDirectory", "/owner/new-store");
    const next = snapshot();
    next.capabilities.storage = false;
    f.apply(next);
    expect(await f.model.saveOwner()).toBe(false);
    expect(f.model.getState().owner?.draft.modelsDirectory).toBe("/owner/new-store");
    expect(f.owners).toEqual([]);
  });
});

describe("write-only credentials and conflict recovery", () => {
  it("permits a corrected explicit Save after a proven validation rejection, retaining its original revision", async () => {
    const f = fixture();
    f.model.editOwner("contextCap", "48000");
    const saving = f.model.saveOwner();
    f.owners[0].reply.reject(
      new BrainSettingsOperationError("validation", "This owner supports a smaller context"),
    );
    expect(await saving).toBe(false);
    expect(f.model.getState().owner).toMatchObject({
      blocked: false,
      draft: { contextCap: "48000" },
      origin: { revision: "owner/opaque-A" },
    });
    expect(f.owners).toHaveLength(1);
    expect(f.ownerReads).toEqual([]);
    f.model.editOwner("contextCap", "40000");
    const corrected = f.model.saveOwner();
    expect(f.owners[1].input.expectedRevision).toBe("owner/opaque-A");
    const accepted = owner();
    accepted.revision = "owner/corrected";
    accepted.config.defaults.contextCap = 40000;
    f.owners[1].reply.resolve(accepted);
    expect(await corrected).toBe(true);
  });

  it.each(["conflict", "unavailable", "unknown"] as const)(
    "classified %s save failure remains reload-blocked",
    async (kind) => {
      const f = fixture();
      f.model.editConnection("enabled", true);
      const saving = f.model.saveConnection();
      f.connections[0].reply.reject(
        new BrainSettingsOperationError(kind, "Save was not confirmed"),
      );
      expect(await saving).toBe(false);
      expect(f.model.getState().connection).toMatchObject({
        blocked: true,
        draft: { enabled: true },
        origin: { revision: "connection/opaque-A" },
      });
      expect(await f.model.saveConnection()).toBe(false);
      expect(f.connections).toHaveLength(1);
      expect(f.connectionReads).toEqual([]);
    },
  );

  it("does not turn a blank replacement into credential removal", async () => {
    const f = fixture();
    f.model.editCredential("access", { action: "replace", value: "" });
    expect(await f.model.saveOwner()).toBe(false);
    expect(f.model.getState().credentialErrors.access).toBe(
      "Enter a replacement or keep the existing credential",
    );
    expect(f.owners).toEqual([]);
    f.model.editCredential("access", { action: "remove", value: "" });
    const saving = f.model.saveOwner();
    expect(f.owners[0].input.credentials.access).toEqual({ action: "remove" });
    const result = owner();
    result.credentials.access = { stored: false, effectiveSource: "none" };
    f.owners[0].reply.resolve(result);
    await saving;
    expect(f.model.getState().credentials.access).toEqual({ action: "keep", value: "" });
  });

  it.each(["Revision conflict", "Host unavailable"])(
    "%s retains dirty inputs and prohibits automatic retry or rebasing",
    async (message) => {
      const f = fixture();
      f.model.editOwner("contextCap", "48000");
      f.model.editCredential("access", { action: "replace", value: "saved-only-in-write" });
      const saving = f.model.saveOwner();
      const next = snapshot();
      const peer = owner();
      peer.revision = "owner/peer";
      peer.config.defaults.contextCap = 64000;
      next.owner = { state: "ready", data: peer };
      f.apply(next);
      f.owners[0].reply.reject(new Error(message));
      expect(await saving).toBe(false);
      expect(await f.model.saveOwner()).toBe(false);
      expect(f.model.getState()).toMatchObject({
        ownerDirty: true,
        owner: {
          blocked: true,
          peerChanged: true,
          draft: { contextCap: "48000" },
          origin: { revision: "owner/opaque-A" },
        },
        credentials: { access: { action: "replace", value: "saved-only-in-write" } },
      });
      expect(f.owners).toHaveLength(1);
      expect(f.ownerReads).toEqual([]);
      expect(JSON.stringify(f.port.getSnapshot())).not.toContain("saved-only-in-write");
    },
  );

  it("redacts both submitted and newer credentials from a failed write's visible error", async () => {
    const f = fixture();
    f.model.editCredential("access", { action: "replace", value: "submitted-private" });
    const saving = f.model.saveOwner();
    f.model.editCredential("access", { action: "replace", value: "newer-private" });
    f.owners[0].reply.reject(new Error("Rejected submitted-private and newer-private"));
    await saving;
    expect(f.model.getState().owner?.error).toBe("Rejected [redacted] and [redacted]");
  });

  it("replaces a conflict draft only after explicit confirmed reload", async () => {
    const f = fixture();
    f.model.editConnection("enabled", true);
    const saving = f.model.saveConnection();
    f.connections[0].reply.reject(new Error("Revision conflict"));
    await saving;
    expect(await f.model.reload("connection", () => Promise.resolve(false))).toBe(false);
    expect(f.connectionReads).toEqual([]);
    const reload = f.model.reload("connection", () => Promise.resolve(true));
    await Promise.resolve();
    const peer = connection();
    peer.revision = "connection/peer";
    peer.config.autoStart = false;
    f.connectionReads[0].resolve(peer);
    expect(await reload).toBe(true);
    expect(f.model.getState()).toMatchObject({
      connectionDirty: false,
      connection: {
        blocked: false,
        origin: { revision: "connection/peer" },
        draft: { enabled: false, autoStart: false },
      },
    });
  });

  it("failed reload leaves its draft and credential intent intact", async () => {
    const f = fixture();
    f.model.editCredential("remote", { action: "replace", value: "remote-draft" });
    const reload = f.model.reload("connection", () => Promise.resolve(true));
    await Promise.resolve();
    f.connectionReads[0].reject(new Error("Cannot read settings"));
    expect(await reload).toBe(false);
    expect(f.model.getState()).toMatchObject({
      connectionDirty: true,
      connection: { blocked: true, origin: { revision: "connection/opaque-A" } },
      credentials: { remote: { action: "replace", value: "remote-draft" } },
    });
  });

  it("does not adopt late reads or confirmations across hide and reactivation", async () => {
    const f = fixture();
    f.model.editConnection("enabled", true);
    const reload = f.model.reload("connection", () => Promise.resolve(true));
    await Promise.resolve();
    f.hide();
    f.activate();
    const late = connection();
    late.revision = "late/read";
    f.connectionReads[0].resolve(late);
    expect(await reload).toBe(false);
    expect(f.model.getState().connection?.origin.revision).toBe("connection/opaque-A");
    const confirmation = deferred<boolean>();
    const next = f.model.reload("connection", () => confirmation.promise);
    f.model.close();
    f.activate();
    confirmation.resolve(true);
    expect(await next).toBe(false);
    expect(f.connectionReads).toHaveLength(1);
  });

  it("requires reload after a hidden write with unknown host outcome", async () => {
    const f = fixture();
    f.model.editOwner("contextCap", "48000");
    const saving = f.model.saveOwner();
    f.hide();
    f.activate();
    const late = owner();
    late.revision = "late/write";
    late.config.defaults.contextCap = 48000;
    f.owners[0].reply.resolve(late);
    expect(await saving).toBe(false);
    expect(f.model.getState()).toMatchObject({
      ownerDirty: true,
      owner: {
        blocked: true,
        draft: { contextCap: "48000" },
        origin: { revision: "owner/opaque-A" },
      },
    });
    expect(await f.model.saveOwner()).toBe(false);
    expect(f.owners).toHaveLength(1);
  });
});

describe("actual owner actions and one-time access keys", () => {
  it("cannot start an unavailable standalone Remote Brain without advertised owner support", async () => {
    const initial = snapshot();
    const remote = owner();
    remote.owner.route = "remote-brain";
    initial.owner = { state: "ready", data: remote };
    initial.status.phase = "unreachable";
    initial.capabilities.lifecycle = { start: false, stop: false, restart: false };
    const f = fixture(initial);
    expect(await f.model.perform("start", () => Promise.resolve(true))).toBe(false);
    expect(f.actions).toEqual([]);
  });

  it("lets a connected owning daemon start its Brain only after explicit confirmation", async () => {
    const f = fixture();
    expect(await f.model.perform("start", () => Promise.resolve(false))).toBe(false);
    expect(f.actions).toEqual([]);
    expect(await f.model.perform("start", () => Promise.resolve(true))).toBe(true);
    expect(f.actions).toEqual([{ ownerId: "actual-owner", action: "start" }]);
    expect(f.connections).toEqual([]);
    expect(f.owners).toEqual([]);
  });

  it("rechecks dirty drafts after a lifecycle confirmation without saving them implicitly", async () => {
    const f = fixture();
    const confirmation = deferred<boolean>();
    const starting = f.model.perform("start", () => confirmation.promise);
    f.model.editOwner("contextCap", "48000");
    confirmation.resolve(true);
    expect(await starting).toBe(false);
    expect(f.actions).toEqual([]);
    expect(f.owners).toEqual([]);
  });

  it("rotates with the originating revision and reveals/copies only the direct new secret", async () => {
    const f = fixture();
    const confirmation = deferred<boolean>();
    const rotating = f.model.generateAccessKey(() => confirmation.promise);
    expect(f.generations).toEqual([]);
    confirmation.resolve(true);
    await Promise.resolve();
    expect(f.generations[0].input).toEqual({
      ownerId: "actual-owner",
      expectedRevision: "owner/opaque-A",
    });
    const accepted = owner();
    accepted.revision = "owner/rotated";
    f.generations[0].reply.resolve({ owner: accepted, secret: "one-time-new-key" });
    expect(await rotating).toBe(true);
    const copied: string[] = [];
    await f.model.copyAccessKey((secret) => {
      copied.push(secret);
      return Promise.resolve();
    });
    expect(copied).toEqual(["one-time-new-key"]);
    expect(f.model.getState().copiedKey).toBe(true);
    expect(JSON.stringify(f.port.getSnapshot())).not.toContain("one-time-new-key");
    f.hide();
    f.activate();
    expect(f.model.getState().revealedKey).toBe(null);
    expect(f.model.getState().owner?.origin.revision).toBe("owner/rotated");
  });

  it("does not lose a preference edited while key generation is pending", async () => {
    const f = fixture();
    const rotating = f.model.generateAccessKey(() => Promise.resolve(true));
    await Promise.resolve();
    f.model.editOwner("contextCap", "48000");
    const accepted = owner();
    accepted.revision = "owner/rotated";
    f.generations[0].reply.resolve({ owner: accepted, secret: "new-key" });
    await rotating;
    expect(f.model.getState()).toMatchObject({
      ownerDirty: true,
      owner: { origin: { revision: "owner/rotated" }, draft: { contextCap: "48000" } },
    });
  });

  it("ignores a hidden rotation reply, clears reveal state, and requires explicit reload", async () => {
    const f = fixture();
    const rotating = f.model.generateAccessKey(() => Promise.resolve(true));
    await Promise.resolve();
    f.hide();
    f.activate();
    const accepted = owner();
    accepted.revision = "owner/unknown-outcome";
    f.generations[0].reply.resolve({ owner: accepted, secret: "must-not-reveal" });
    expect(await rotating).toBe(false);
    expect(f.model.getState()).toMatchObject({
      revealedKey: null,
      owner: { blocked: true, origin: { revision: "owner/opaque-A" } },
    });
    expect(await f.model.generateAccessKey(() => Promise.resolve(true))).toBe(false);
    expect(f.generations).toHaveLength(1);
  });

  it("does not rotate after a stale confirmation or revoked generation capability", async () => {
    const f = fixture();
    const confirmation = deferred<boolean>();
    const rotating = f.model.generateAccessKey(() => confirmation.promise);
    const next = snapshot();
    next.capabilities.generateAccessKey = false;
    f.apply(next);
    confirmation.resolve(true);
    expect(await rotating).toBe(false);
    expect(f.generations).toEqual([]);
  });

  it("does not turn a confirmation from a hidden activation into a new rotation", async () => {
    const f = fixture();
    const confirmation = deferred<boolean>();
    const rotating = f.model.generateAccessKey(() => confirmation.promise);
    f.hide();
    f.activate();
    confirmation.resolve(true);
    expect(await rotating).toBe(false);
    expect(f.generations).toEqual([]);
  });

  it("a failed rotation never reveals an existing credential or retries on its own", async () => {
    const f = fixture();
    const rotating = f.model.generateAccessKey(() => Promise.resolve(true));
    await Promise.resolve();
    f.generations[0].reply.reject(new Error("Key revision conflict"));
    expect(await rotating).toBe(false);
    expect(f.model.getState()).toMatchObject({
      revealedKey: null,
      owner: {
        blocked: true,
        error: "Key revision conflict",
        origin: { revision: "owner/opaque-A" },
      },
    });
    expect(await f.model.generateAccessKey(() => Promise.resolve(true))).toBe(false);
    expect(f.generations).toHaveLength(1);
    expect(f.ownerReads).toEqual([]);
  });

  it("clears the one-time reveal and user-entered secret drafts on close", async () => {
    const f = fixture();
    const rotating = f.model.generateAccessKey(() => Promise.resolve(true));
    await Promise.resolve();
    f.generations[0].reply.resolve({ owner: owner(), secret: "close-only-key" });
    await rotating;
    f.model.editCredential("remote", { action: "replace", value: "private-remote-draft" });
    f.model.close();
    expect(f.model.getState()).toMatchObject({
      revealedKey: null,
      credentials: {
        remote: { action: "keep", value: "" },
        access: { action: "keep", value: "" },
        huggingFace: { action: "keep", value: "" },
      },
    });
    expect(JSON.stringify(f.port.getSnapshot())).not.toContain("close-only-key");
    expect(JSON.stringify(f.port.getSnapshot())).not.toContain("private-remote-draft");
  });

  it("keeps discovery read-only until detected certificate values are explicitly applied and saved", async () => {
    const f = fixture();
    f.port.discoverNetwork = (ownerId) =>
      Promise.resolve({
        ownerId,
        addresses: [{ id: "10.0.0.2", label: "Owner LAN" }],
        tailscale: {
          available: true,
          hostname: "owner.ts.net",
          certificateDirectory: "/owner/tailscale-certs",
        },
      });
    expect(await f.model.discoverNetwork()).toBe(true);
    expect(f.model.getState().ownerDirty).toBe(false);
    expect(f.owners).toEqual([]);
    expect(f.actions).toEqual([]);
    f.model.applyDiscoveredTls();
    expect(f.model.getState()).toMatchObject({
      ownerDirty: true,
      owner: { draft: { hostname: "owner.ts.net", certDirectory: "/owner/tailscale-certs" } },
    });
    expect(f.owners).toEqual([]);
  });

  it("requires explicit owner reload when the saved target changes instead of reassigning a dirty draft", async () => {
    const f = fixture();
    f.model.editOwner("modelsDirectory", "/original-owner/edited");
    const next = snapshot();
    const other = owner();
    other.owner = { id: "different-owner", label: "Different owner", route: "remote-brain" };
    next.owner = { state: "ready", data: other };
    f.apply(next);
    expect(f.model.getState()).toMatchObject({
      targetChanged: true,
      owner: {
        origin: { owner: { id: "actual-owner" } },
        draft: { modelsDirectory: "/original-owner/edited" },
      },
    });
    expect(await f.model.saveOwner()).toBe(false);
    expect(f.owners).toEqual([]);
    const reloading = f.model.reload("owner", () => Promise.resolve(true));
    await Promise.resolve();
    expect(f.ownerReads[0].ownerId).toBe("different-owner");
    f.ownerReads[0].reply.resolve(other);
    expect(await reloading).toBe(true);
    expect(f.model.getState().owner?.origin.owner.id).toBe("different-owner");
  });

  it("clears a one-time key immediately when the actual saved owner changes", async () => {
    const f = fixture();
    const rotating = f.model.generateAccessKey(() => Promise.resolve(true));
    await Promise.resolve();
    f.generations[0].reply.resolve({ owner: owner(), secret: "previous-owner-key" });
    await rotating;
    const next = snapshot();
    const other = owner();
    other.owner.id = "other-owner";
    next.owner = { state: "ready", data: other };
    f.apply(next);
    expect(f.model.getState()).toMatchObject({
      targetChanged: true,
      revealedKey: null,
      copiedKey: false,
    });
  });

  it("redacts a clipboard failure even after the reveal was explicitly hidden", async () => {
    const f = fixture();
    const rotating = f.model.generateAccessKey(() => Promise.resolve(true));
    await Promise.resolve();
    f.generations[0].reply.resolve({ owner: owner(), secret: "clipboard-private-key" });
    await rotating;
    const clipboard = deferred<void>();
    const copying = f.model.copyAccessKey(() => clipboard.promise);
    f.model.hideAccessKey();
    clipboard.reject(new Error("Cannot copy clipboard-private-key"));
    await copying;
    expect(f.model.getState()).toMatchObject({
      revealedKey: null,
      notice: "Cannot copy [redacted]",
    });
  });
});
