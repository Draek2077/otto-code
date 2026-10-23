import type {
  BrainConnectionConfig,
  BrainConnectionPatch,
  BrainCredentialIntent,
  BrainLogVerbosity,
  BrainOwnerConfig,
  BrainOwnerPatch,
  BrainRuntimeSource,
  BrainSettingsMode,
  BrainTlsMode,
} from "./contracts";

export interface ConnectionDraft {
  enabled: boolean;
  autoStart: boolean;
  mode: BrainSettingsMode;
  remoteHost: string;
  remotePort: string;
  remoteSecure: boolean;
  remoteFingerprint: string;
}

export interface OwnerDraft {
  runtimeSource: BrainRuntimeSource;
  runtimeSelectionId: string | null;
  runtimePath: string;
  logVerbosity: BrainLogVerbosity;
  modelsDirectory: string;
  cacheTypeK: string;
  cacheTypeV: string;
  flashAttention: boolean;
  reasoningBudget: string;
  parallelSlots: string;
  contextCap: string;
  defaultModelId: string | null;
  maxLoadedModels: string;
  lockModel: boolean;
  lockedModelIds: string[];
  listenHost: string;
  listenPort: string;
  authMode: "none" | "token";
  allowRemoteConfig: boolean;
  allowInsecureBind: boolean;
  tlsMode: BrainTlsMode;
  certFile: string;
  keyFile: string;
  hostname: string;
  certDirectory: string;
  renewBeforeDays: string;
  checkIntervalMs: string;
  tailscaleExecutable: string;
}

export interface CredentialDraft {
  action: BrainCredentialIntent["action"];
  value: string;
}

export const keepCredential = (): CredentialDraft => ({ action: "keep", value: "" });

export function credentialIntent(draft: CredentialDraft): BrainCredentialIntent {
  if (draft.action === "replace") return { action: "replace", value: draft.value };
  return { action: draft.action };
}

export function connectionDraft(config: BrainConnectionConfig): ConnectionDraft {
  return {
    enabled: config.enabled,
    autoStart: config.autoStart,
    mode: config.mode,
    remoteHost: config.remote.host,
    remotePort: String(config.remote.port),
    remoteSecure: config.remote.secure,
    remoteFingerprint: config.remote.certFingerprint ?? "",
  };
}

export function ownerDraft(config: BrainOwnerConfig): OwnerDraft {
  return {
    runtimeSource: config.runtime.source,
    runtimeSelectionId: config.runtime.selectionId,
    runtimePath: config.runtime.executablePath ?? "",
    logVerbosity: config.runtime.logVerbosity,
    modelsDirectory: config.storage.modelsDirectory ?? "",
    cacheTypeK: config.defaults.cacheTypeK,
    cacheTypeV: config.defaults.cacheTypeV,
    flashAttention: config.defaults.flashAttention,
    reasoningBudget: String(config.defaults.reasoningBudget),
    parallelSlots: String(config.defaults.parallelSlots),
    contextCap: String(config.defaults.contextCap),
    defaultModelId: config.residency.defaultModelId,
    lockModel: config.residency.lockModel,
    maxLoadedModels: String(config.residency.maxLoadedModels),
    lockedModelIds: [...config.residency.lockedModelIds],
    listenHost: config.access.listenHost,
    authMode: config.access.authMode,
    allowRemoteConfig: config.access.allowRemoteConfig,
    allowInsecureBind: config.access.allowInsecureBind,
    listenPort: String(config.access.listenPort),
    tlsMode: config.tls.mode,
    certFile: config.tls.certFile ?? "",
    keyFile: config.tls.keyFile ?? "",
    hostname: config.tls.hostname ?? "",
    certDirectory: config.tls.certDirectory ?? "",
    renewBeforeDays: String(config.tls.renewBeforeDays),
    checkIntervalMs: String(config.tls.checkIntervalMs),
    tailscaleExecutable: config.tls.tailscaleExecutable ?? "",
  };
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A normalized reply may update untouched fields, but must not erase newer edits. */
export function acknowledgeDraft<T extends object>(current: T, submitted: T, accepted: T): T {
  const next = { ...accepted };
  for (const key in submitted) {
    if (!sameValue(current[key], submitted[key])) next[key] = current[key];
  }
  return next;
}

// Untouched legacy spellings remain byte-for-byte values in the patch origin.
function nullable(value: string, original: string | null): string | null {
  if (value === (original ?? "")) return original;
  return value === "" ? null : value;
}

function changed<T extends object>(original: T, next: T, keys: readonly (keyof T)[]): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of keys) {
    if (!sameValue(original[key], next[key])) patch[key] = next[key];
  }
  return patch;
}

export function connectionPatch(
  original: BrainConnectionConfig,
  draft: ConnectionDraft,
): BrainConnectionPatch {
  const next: BrainConnectionConfig = {
    enabled: draft.enabled,
    autoStart: draft.autoStart,
    mode: draft.mode,
    remote: {
      host: draft.remoteHost,
      port: Number(draft.remotePort),
      secure: draft.remoteSecure,
      certFingerprint: nullable(draft.remoteFingerprint, original.remote.certFingerprint),
    },
  };
  const patch: BrainConnectionPatch = changed(original, next, ["enabled", "autoStart", "mode"]);
  const remote = changed(original.remote, next.remote, [
    "host",
    "port",
    "secure",
    "certFingerprint",
  ]);
  if (Object.keys(remote).length > 0) patch.remote = remote;
  return patch;
}

export function ownerPatch(original: BrainOwnerConfig, draft: OwnerDraft): BrainOwnerPatch {
  const patch: BrainOwnerPatch = {};
  const runtime = changed(
    original.runtime,
    {
      source: draft.runtimeSource,
      selectionId: draft.runtimeSelectionId,
      executablePath: nullable(draft.runtimePath, original.runtime.executablePath),
      logVerbosity: draft.logVerbosity,
    },
    ["source", "selectionId", "executablePath", "logVerbosity"],
  );
  const storage = changed(
    original.storage,
    { modelsDirectory: nullable(draft.modelsDirectory, original.storage.modelsDirectory) },
    ["modelsDirectory"],
  );
  const defaults = changed(
    original.defaults,
    {
      cacheTypeK: draft.cacheTypeK,
      cacheTypeV: draft.cacheTypeV,
      flashAttention: draft.flashAttention,
      reasoningBudget: Number(draft.reasoningBudget),
      parallelSlots: Number(draft.parallelSlots),
      contextCap: Number(draft.contextCap),
    },
    [
      "cacheTypeK",
      "cacheTypeV",
      "flashAttention",
      "reasoningBudget",
      "parallelSlots",
      "contextCap",
    ],
  );
  const residency = changed(
    original.residency,
    {
      defaultModelId: draft.defaultModelId,
      maxLoadedModels: Number(draft.maxLoadedModels),
      lockModel: draft.lockModel,
      lockedModelIds: draft.lockedModelIds,
    },
    ["defaultModelId", "maxLoadedModels", "lockModel", "lockedModelIds"],
  );
  const access = changed(
    original.access,
    {
      listenHost: draft.listenHost,
      listenPort: Number(draft.listenPort),
      authMode: draft.authMode,
      allowRemoteConfig: draft.allowRemoteConfig,
      allowInsecureBind: draft.allowInsecureBind,
    },
    ["listenHost", "listenPort", "authMode", "allowRemoteConfig", "allowInsecureBind"],
  );
  const tls = changed(
    original.tls,
    {
      mode: draft.tlsMode,
      certFile: nullable(draft.certFile, original.tls.certFile),
      keyFile: nullable(draft.keyFile, original.tls.keyFile),
      hostname: nullable(draft.hostname, original.tls.hostname),
      certDirectory: nullable(draft.certDirectory, original.tls.certDirectory),
      renewBeforeDays: Number(draft.renewBeforeDays),
      checkIntervalMs: Number(draft.checkIntervalMs),
      tailscaleExecutable: nullable(draft.tailscaleExecutable, original.tls.tailscaleExecutable),
    },
    [
      "mode",
      "certFile",
      "keyFile",
      "hostname",
      "certDirectory",
      "renewBeforeDays",
      "checkIntervalMs",
      "tailscaleExecutable",
    ],
  );
  if (Object.keys(runtime).length) patch.runtime = runtime;
  if (Object.keys(storage).length) patch.storage = storage;
  if (Object.keys(defaults).length) patch.defaults = defaults;
  if (Object.keys(residency).length) patch.residency = residency;
  if (Object.keys(access).length) patch.access = access;
  if (Object.keys(tls).length) patch.tls = tls;
  return patch;
}

export function validateInteger(value: string, min?: number, max?: number): string | null {
  if (!/^-?\d+$/.test(value.trim())) return "Enter a whole number";
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return "Enter a whole number within the supported range";
  if (min !== undefined && number < min) return `Enter ${min} or more`;
  if (max !== undefined && number > max) return `Enter ${max} or less`;
  return null;
}

export function connectionErrors(
  draft: ConnectionDraft,
  original?: ConnectionDraft,
): Partial<Record<keyof ConnectionDraft, string>> {
  const errors: Partial<Record<keyof ConnectionDraft, string>> = {};
  const changedMode = original?.mode !== draft.mode;
  if (
    draft.mode === "remote" &&
    (changedMode || original?.remoteHost !== draft.remoteHost) &&
    !draft.remoteHost.trim()
  ) {
    errors.remoteHost = "Enter the Remote Brain hostname";
  }
  if (changedMode || original?.remotePort !== draft.remotePort) {
    const port = validateInteger(draft.remotePort, 1, 65535);
    if (port) errors.remotePort = port;
  }
  return errors;
}

function residencyErrors(
  draft: OwnerDraft,
  original?: OwnerDraft,
): Partial<Record<keyof OwnerDraft, string>> {
  const changedResidency =
    !original ||
    original.lockModel !== draft.lockModel ||
    original.maxLoadedModels !== draft.maxLoadedModels ||
    !sameValue(original.lockedModelIds, draft.lockedModelIds);
  return changedResidency &&
    draft.lockModel &&
    draft.lockedModelIds.length > Number(draft.maxLoadedModels)
    ? { lockedModelIds: "The locked set exceeds the model process limit" }
    : {};
}

function certificateErrors(
  draft: OwnerDraft,
  original?: OwnerDraft,
): Partial<Record<keyof OwnerDraft, string>> {
  const changedFiles =
    original?.tlsMode !== draft.tlsMode ||
    original?.certFile !== draft.certFile ||
    original?.keyFile !== draft.keyFile;
  if (!changedFiles || draft.tlsMode !== "files") return {};
  return {
    ...(!draft.certFile.trim() ? { certFile: "Enter the owning host's certificate file" } : {}),
    ...(!draft.keyFile.trim() ? { keyFile: "Enter the owning host's key file" } : {}),
  };
}

export function ownerErrors(
  draft: OwnerDraft,
  original?: OwnerDraft,
): Partial<Record<keyof OwnerDraft, string>> {
  const errors: Partial<Record<keyof OwnerDraft, string>> = {};
  const rules = [
    ["listenPort", 1, 65535],
    ["maxLoadedModels", 1, 16],
    ["parallelSlots", undefined, undefined],
    ["contextCap", undefined, undefined],
    ["reasoningBudget", undefined, undefined],
    ["renewBeforeDays", 0, undefined],
    ["checkIntervalMs", undefined, undefined],
  ] as const;
  for (const [key, min, max] of rules) {
    if (original && original[key] === draft[key]) continue;
    const error = validateInteger(draft[key], min, max);
    if (error) errors[key] = error;
  }
  if (original?.listenHost !== draft.listenHost && !draft.listenHost.trim())
    errors.listenHost = "Enter the owning host's listen address";
  return { ...errors, ...residencyErrors(draft, original), ...certificateErrors(draft, original) };
}
