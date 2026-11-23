/** Explicit projection between standalone owner settings and the app's form contract. */
import type { BrainOwnerRead as OwnerDto } from "@getpaseo/protocol/otto/brain";
import type { BrainOwnerRead, BrainOwnerPatch, BrainSettingsMode } from "../settings/contracts";

export function ownerToForm(owner: OwnerDto, mode: BrainSettingsMode): BrainOwnerRead {
  const config = owner.config;
  return {
    version: 1,
    owner: {
      id: owner.ownerId,
      label: owner.ownerLabel,
      route: mode === "local" ? "owning-daemon" : "remote-brain",
    },
    revision: owner.revision,
    config: {
      runtime: {
        source: config.runtime.source,
        selectionId: config.runtime.selectionId,
        executablePath: config.runtime.path,
        logVerbosity: config.runtime.logVerbosity,
      },
      storage: { modelsDirectory: config.modelsDir },
      defaults: { ...config.defaults },
      residency: {
        defaultModelId: config.defaultModel,
        maxLoadedModels: config.maxLoadedModels,
        lockModel: config.lockModel,
        lockedModelIds: config.lockedModels,
      },
      access: {
        listenHost: config.listen.host,
        listenPort: config.listen.port,
        authMode: config.auth.mode,
        allowRemoteConfig: config.allowRemoteConfig,
        allowInsecureBind: config.allowInsecureBind,
      },
      tls: {
        mode: config.tls.mode,
        certFile: config.tls.certFile,
        keyFile: config.tls.keyFile,
        hostname: config.tls.hostname,
        certDirectory: config.tls.certDir,
        renewBeforeDays: config.tls.renewBeforeDays,
        checkIntervalMs: config.tls.checkIntervalMs,
        tailscaleExecutable: config.tls.tailscaleExe,
      },
    },
    credentials: owner.credentials,
    resolved: {
      runtimeLabel: owner.resolved.runtimeLabel ?? "Not configured",
      executablePath: owner.resolved.executablePath,
      modelsDirectory: owner.resolved.modelsDirectory,
      certificateDirectory: owner.resolved.certificateDirectory,
      totalBytes: null,
      freeBytes: null,
    },
    requiresRestart: owner.requiresRestart,
  };
}

function runtimePatch(patch: BrainOwnerPatch["runtime"]) {
  if (!patch) return undefined;
  return {
    source: patch.source,
    selectionId: patch.selectionId,
    path: patch.executablePath,
    logVerbosity: patch.logVerbosity,
  };
}
function tlsPatch(patch: BrainOwnerPatch["tls"]) {
  if (!patch) return undefined;
  return {
    mode: patch.mode,
    certFile: patch.certFile,
    keyFile: patch.keyFile,
    hostname: patch.hostname,
    certDir: patch.certDirectory,
    renewBeforeDays: patch.renewBeforeDays,
    checkIntervalMs: patch.checkIntervalMs,
    tailscaleExe: patch.tailscaleExecutable,
  };
}
function listenPatch(patch: BrainOwnerPatch["access"]) {
  if (patch?.listenHost === undefined && patch?.listenPort === undefined) return undefined;
  return { host: patch?.listenHost, port: patch?.listenPort };
}
/** Undefined is omitted by the existing JSON envelope; null remains an explicit clear. */
export function ownerPatchToHost(patch: BrainOwnerPatch) {
  return {
    runtime: runtimePatch(patch.runtime),
    modelsDir: patch.storage?.modelsDirectory,
    defaults: patch.defaults,
    defaultModel: patch.residency?.defaultModelId,
    maxLoadedModels: patch.residency?.maxLoadedModels,
    lockModel: patch.residency?.lockModel,
    lockedModels: patch.residency?.lockedModelIds,
    listen: listenPatch(patch.access),
    auth: patch.access?.authMode === undefined ? undefined : { mode: patch.access.authMode },
    allowRemoteConfig: patch.access?.allowRemoteConfig,
    allowInsecureBind: patch.access?.allowInsecureBind,
    tls: tlsPatch(patch.tls),
  };
}
