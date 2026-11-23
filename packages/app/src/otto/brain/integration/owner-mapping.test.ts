import { expect, test } from "vitest";
import { BrainOwnerReadSchema, type BrainOwnerRead } from "@getpaseo/protocol/otto/brain";
import { ownerPatchToHost, ownerToForm } from "./owner-mapping";
import { BrainConnectionState } from "./connection-state";
import { BrainRpc } from "./rpc";
import { BrainSettingsFacade } from "./settings-port";

function owner(): BrainOwnerRead {
  return {
    version: 1,
    ownerId: "actual-remote-owner",
    ownerLabel: "Remote workstation",
    revision: "origin-revision",
    config: {
      runtime: {
        source: "lmstudio",
        selectionId: "opaque-runtime",
        path: "/owner/runtime",
        logVerbosity: 2,
      },
      modelsDir: null,
      defaults: {
        cacheTypeK: "q8_0",
        cacheTypeV: "f16",
        flashAttention: true,
        reasoningBudget: 768,
        parallelSlots: 2,
        contextCap: 32000,
      },
      defaultModel: "model-id",
      maxLoadedModels: 2,
      lockedModels: ["model-id"],
      lockModel: true,
      listen: { host: "127.0.0.1", port: 4567 },
      auth: { mode: "token" },
      allowRemoteConfig: false,
      allowInsecureBind: false,
      tls: {
        mode: "files",
        certFile: "/owner/cert",
        keyFile: "/owner/key",
        hostname: "owner.example",
        certDir: null,
        renewBeforeDays: 21,
        checkIntervalMs: 43200000,
        tailscaleExe: null,
      },
    },
    credentials: {
      access: { stored: true, effectiveSource: "stored" },
      huggingFace: { stored: false, effectiveSource: "environment" },
    },
    resolved: {
      runtimeLabel: "Installed runtime",
      executablePath: "/owner/runtime",
      modelsDirectory: "/owner/models",
      certificateDirectory: "/owner/certs",
    },
    choices: {
      models: [{ id: "model-id", label: "My model" }],
      runtimes: [{ id: "opaque-runtime", label: "Installed runtime" }],
      cacheTypes: [{ id: "q8_0", label: "Q8_0" }],
    },
    requiresRestart: true,
    capabilities: {
      networkDiscovery: true,
      runtimeSelection: true,
      storage: true,
      accessCredential: true,
      huggingFaceCredential: false,
    },
  };
}
function onWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("projects the actual owner identity, paths and opaque runtime without guessing client paths", () => {
  const form = ownerToForm(owner(), "remote");
  expect(form.owner).toEqual({
    id: "actual-remote-owner",
    label: "Remote workstation",
    route: "remote-brain",
  });
  expect(form.revision).toBe("origin-revision");
  expect(form.resolved.modelsDirectory).toBe("/owner/models");
  expect(form.config.runtime).toEqual({
    source: "lmstudio",
    selectionId: "opaque-runtime",
    executablePath: "/owner/runtime",
    logVerbosity: 2,
  });
  expect(form.credentials.huggingFace.effectiveSource).toBe("environment");
  expect(form.resolved.freeBytes).toBeNull();
});
test("one edited field sends a partial patch without resetting unrelated settings", () => {
  expect(onWire(ownerPatchToHost({ tls: { renewBeforeDays: 14 } }))).toEqual({
    tls: { renewBeforeDays: 14 },
  });
  expect(onWire(ownerPatchToHost({ runtime: { logVerbosity: 0 } }))).toEqual({
    runtime: { logVerbosity: 0 },
  });
});
test("preserves explicit clears, false flags and empty model locks", () => {
  expect(
    onWire(
      ownerPatchToHost({
        storage: { modelsDirectory: null },
        residency: { defaultModelId: null, lockedModelIds: [], lockModel: false },
        access: { allowRemoteConfig: false, authMode: "none" },
      }),
    ),
  ).toEqual({
    modelsDir: null,
    defaultModel: null,
    lockedModels: [],
    lockModel: false,
    auth: { mode: "none" },
    allowRemoteConfig: false,
  });
});
test("passes installed runtime identity and explicit path changes as separate owner fields", () => {
  expect(
    onWire(
      ownerPatchToHost({ runtime: { selectionId: "opaque/runtime-choice", executablePath: null } }),
    ),
  ).toEqual({ runtime: { selectionId: "opaque/runtime-choice", path: null } });
});
test("owner response allowlist removes unexpected secret fields before canonical UI state", () => {
  const source = owner();
  const parsed = BrainOwnerReadSchema.parse({
    ...source,
    secret: "unexpected-private-value",
    config: {
      ...source.config,
      hfToken: "unexpected-private-value",
      auth: { mode: "token", token: "unexpected-private-value" },
    },
  });
  expect(JSON.stringify(parsed)).not.toContain("unexpected-private-value");
  expect(parsed.credentials.access.stored).toBe(true);
});

function connection() {
  return {
    version: 1,
    revision: "connection-origin",
    credential: { stored: false, effectiveSource: "none" },
    config: {
      enabled: true,
      autoStart: false,
      mode: "local",
      remote: { host: "", port: 1234, secure: false, certFingerprint: null },
    },
  };
}
test("the actual settings facade sends a partial owner save and publishes only its accepted revision", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  const core = new BrainConnectionState(
    new BrainRpc(async (method, input) => {
      calls.push({ method, input });
      if (method === "brain.bootstrap")
        return {
          ok: true,
          value: {
            connection: connection(),
            owner: owner(),
            ownerError: null,
            localRunning: false,
            endpoint: "https://actual-listener:4567",
          },
        };
      const saved = owner();
      saved.revision = "accepted-owner-revision";
      saved.config.runtime.logVerbosity = 4;
      return { ok: true, value: saved };
    }),
  );
  const facade = new BrainSettingsFacade(
    core,
    { serverId: "selected-daemon", label: "My host" },
    () => {},
  );
  try {
    await core.refresh();
    expect(facade.getSnapshot().status.endpoint).toBe("https://actual-listener:4567");
    expect(facade.getSnapshot().capabilities.runtime).toBe(true);
    const saved = await facade.saveOwner({
      ownerId: "actual-remote-owner",
      expectedRevision: "origin-revision",
      patch: { runtime: { logVerbosity: 4 } },
      credentials: { access: { action: "keep" }, huggingFace: { action: "keep" } },
    });
    expect(onWire(calls[1])).toEqual({
      method: "brain.owner.save",
      input: {
        ownerId: "actual-remote-owner",
        expectedRevision: "origin-revision",
        patch: { runtime: { logVerbosity: 4 } },
        credentials: { access: { action: "keep" }, huggingFace: { action: "keep" } },
      },
    });
    expect(saved.revision).toBe("accepted-owner-revision");
    expect(facade.getSnapshot().owner.data?.revision).toBe("accepted-owner-revision");
  } finally {
    facade.close();
    core.close();
  }
});
test("a generated key is returned once to its caller and is absent from both canonical projections", async () => {
  const core = new BrainConnectionState(
    new BrainRpc(async (method) => {
      if (method === "brain.bootstrap")
        return {
          ok: true,
          value: {
            connection: connection(),
            owner: owner(),
            ownerError: null,
            localRunning: false,
            endpoint: null,
          },
        };
      const next = owner();
      next.revision = "new-key-revision";
      return { ok: true, value: { owner: next, secret: "new-direct-secret-only" } };
    }),
  );
  const facade = new BrainSettingsFacade(core, { serverId: "daemon", label: "Host" }, () => {});
  try {
    await core.refresh();
    const generated = await facade.generateAccessKey({
      ownerId: "actual-remote-owner",
      expectedRevision: "origin-revision",
    });
    expect(generated.secret).toBe("new-direct-secret-only");
    expect(facade.getSnapshot().owner.data?.revision).toBe("new-key-revision");
    expect(JSON.stringify(facade.getSnapshot())).not.toContain("new-direct-secret-only");
    expect(JSON.stringify(core.getSnapshot())).not.toContain("new-direct-secret-only");
  } finally {
    facade.close();
    core.close();
  }
});
test("a validation rejection does not adopt a host revision or discard the current owner snapshot", async () => {
  const core = new BrainConnectionState(
    new BrainRpc(async (method) =>
      method === "brain.bootstrap"
        ? {
            ok: true,
            value: {
              connection: connection(),
              owner: owner(),
              ownerError: null,
              localRunning: false,
              endpoint: null,
            },
          }
        : { ok: false, error: { kind: "validation", message: "Correct this field" } },
    ),
  );
  const facade = new BrainSettingsFacade(core, { serverId: "daemon", label: "Host" }, () => {});
  try {
    await core.refresh();
    await expect(
      facade.saveOwner({
        ownerId: "actual-remote-owner",
        expectedRevision: "origin-revision",
        patch: { defaults: { parallelSlots: 0 } },
        credentials: { access: { action: "keep" }, huggingFace: { action: "keep" } },
      }),
    ).rejects.toMatchObject({ kind: "validation" });
    expect(facade.getSnapshot().owner.data?.revision).toBe("origin-revision");
  } finally {
    facade.close();
    core.close();
  }
});
