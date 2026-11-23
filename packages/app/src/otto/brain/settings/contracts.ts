/** Presentation contracts only. The owning adapter maps validated host DTOs here. */
export type BrainSettingsMode = "local" | "remote";
export type BrainTlsMode = "off" | "files" | "self-signed" | "tailscale";
export type BrainRuntimeSource = "auto" | "managed" | "lmstudio";
export type BrainLogVerbosity = 0 | 1 | 2 | 3 | 4 | 5;
export type BrainCredentialSlot = "remote" | "access" | "huggingFace";

export type BrainSettingsErrorKind = "validation" | "conflict" | "unavailable" | "unknown";

/**
 * The adapter supplies a sanitized message and a proven classification, never
 * guesses from text/status alone. `validation` guarantees rejection before any
 * mutation. Unavailable and unknown save outcomes remain conservative.
 */
export class BrainSettingsOperationError extends Error {
  constructor(
    readonly kind: BrainSettingsErrorKind,
    sanitizedMessage: string,
    options?: ErrorOptions,
  ) {
    super(sanitizedMessage, options);
    this.name = "BrainSettingsOperationError";
  }
}

export interface BrainCredentialStatus {
  stored: boolean;
  effectiveSource: "none" | "stored" | "environment";
}

/** Blank text is never a removal request. Secrets occur only in explicit writes. */
export type BrainCredentialIntent =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "remove" };

export interface BrainConnectionConfig {
  enabled: boolean;
  autoStart: boolean;
  mode: BrainSettingsMode;
  remote: {
    host: string;
    port: number;
    secure: boolean;
    certFingerprint: string | null;
  };
}

export interface BrainConnectionRead {
  version: 1;
  revision: string;
  config: BrainConnectionConfig;
  credential: BrainCredentialStatus;
}

export interface BrainOwnerConfig {
  runtime: {
    source: BrainRuntimeSource;
    /** Opaque installed selection issued by this owner, never a client-derived path. */
    selectionId: string | null;
    executablePath: string | null;
    logVerbosity: BrainLogVerbosity;
  };
  storage: { modelsDirectory: string | null };
  defaults: {
    cacheTypeK: string;
    cacheTypeV: string;
    flashAttention: boolean;
    reasoningBudget: number;
    parallelSlots: number;
    contextCap: number;
  };
  residency: {
    defaultModelId: string | null;
    maxLoadedModels: number;
    lockModel: boolean;
    lockedModelIds: string[];
  };
  access: {
    listenHost: string;
    listenPort: number;
    authMode: "none" | "token";
    allowRemoteConfig: boolean;
    allowInsecureBind: boolean;
  };
  tls: {
    mode: BrainTlsMode;
    certFile: string | null;
    keyFile: string | null;
    hostname: string | null;
    certDirectory: string | null;
    renewBeforeDays: number;
    checkIntervalMs: number;
    tailscaleExecutable: string | null;
  };
}

export interface BrainSettingsOwner {
  /** Stable configuration owner, distinct from a per-process status instance ID. */
  id: string;
  label: string;
  route: "owning-daemon" | "remote-brain";
}

export interface BrainOwnerRead {
  version: 1;
  owner: BrainSettingsOwner;
  revision: string;
  config: BrainOwnerConfig;
  credentials: { access: BrainCredentialStatus; huggingFace: BrainCredentialStatus };
  resolved: {
    runtimeLabel: string;
    executablePath: string | null;
    modelsDirectory: string;
    totalBytes: number | null;
    freeBytes: number | null;
    certificateDirectory: string | null;
  };
  requiresRestart: boolean;
}

export type BrainSettingsResource<T> =
  | { state: "connecting" | "loading"; data: T | null }
  | { state: "ready"; data: T }
  | { state: "error"; data: T | null; message: string };

export interface BrainSettingsChoice {
  id: string;
  label: string;
}

export interface BrainSettingsChoices {
  models: readonly BrainSettingsChoice[];
  runtimes: readonly BrainSettingsChoice[];
  cacheTypes: readonly BrainSettingsChoice[];
  bindAddresses: readonly BrainSettingsChoice[];
}

export interface BrainSettingsCapabilities {
  supported: {
    runtime: boolean;
    storage: boolean;
    defaults: boolean;
    residency: boolean;
    access: boolean;
    tls: boolean;
    logging: boolean;
  };
  /** Remaining section flags authorize writes; supported read-only fields stay visible. */
  editConnection: boolean;
  remoteConnection: boolean;
  runtime: boolean;
  storage: boolean;
  defaults: boolean;
  residency: boolean;
  access: boolean;
  tls: boolean;
  logging: boolean;
  remoteCredential: boolean;
  accessCredential: boolean;
  huggingFaceCredential: boolean;
  discoverNetwork: boolean;
  generateAccessKey: boolean;
  /** Actual owning route permissions, not inferred from browser locality. */
  lifecycle: { start: boolean; stop: boolean; restart: boolean };
}

export interface BrainSettingsStatus {
  phase: "disabled" | "connecting" | "unreachable" | "stopped" | "starting" | "running" | "failed";
  version: string | null;
  endpoint: string | null;
  modelLabel: string | null;
  message: string | null;
}

export interface BrainSettingsSnapshot {
  version: 1;
  host: { serverId: string; label: string; connected: boolean };
  connection: BrainSettingsResource<BrainConnectionRead>;
  owner: BrainSettingsResource<BrainOwnerRead>;
  status: BrainSettingsStatus;
  capabilities: BrainSettingsCapabilities;
  choices: BrainSettingsChoices;
}

export interface BrainConnectionPatch {
  enabled?: boolean;
  autoStart?: boolean;
  mode?: BrainSettingsMode;
  remote?: Partial<BrainConnectionConfig["remote"]>;
}

export interface BrainOwnerPatch {
  runtime?: Partial<BrainOwnerConfig["runtime"]>;
  storage?: Partial<BrainOwnerConfig["storage"]>;
  defaults?: Partial<BrainOwnerConfig["defaults"]>;
  residency?: Partial<BrainOwnerConfig["residency"]>;
  access?: Partial<BrainOwnerConfig["access"]>;
  tls?: Partial<BrainOwnerConfig["tls"]>;
}

export interface BrainNetworkDiscovery {
  ownerId: string;
  addresses: readonly BrainSettingsChoice[];
  tailscale: {
    available: boolean;
    hostname: string | null;
    certificateDirectory: string | null;
  };
}

/** Stable per selected daemon. Reconnects update this adapter's canonical snapshot. */
export interface BrainSettingsPort {
  version: 1;
  getSnapshot: () => BrainSettingsSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Parent owns one canonical demand/snapshot source; no UI polling or cache. */
  retainSettings: () => () => void;
  /** Reads and accepted writes update the same parent-owned sanitized store. */
  readConnection: () => Promise<BrainConnectionRead>;
  readOwner: (ownerId: string) => Promise<BrainOwnerRead>;
  saveConnection: (input: {
    expectedRevision: string;
    patch: BrainConnectionPatch;
    credential: BrainCredentialIntent;
  }) => Promise<BrainConnectionRead>;
  saveOwner: (input: {
    ownerId: string;
    expectedRevision: string;
    patch: BrainOwnerPatch;
    credentials: { access: BrainCredentialIntent; huggingFace: BrainCredentialIntent };
  }) => Promise<BrainOwnerRead>;
  performOwnerAction: (input: {
    ownerId: string;
    action: "start" | "stop" | "restart";
  }) => Promise<void>;
  discoverNetwork: (ownerId: string) => Promise<BrainNetworkDiscovery>;
  /**
   * User-confirmed generation/rotation. Persist privately on the owner. Publish
   * ONLY `owner` to the canonical store; `secret` is a direct, one-time result.
   */
  generateAccessKey: (input: {
    ownerId: string;
    expectedRevision: string;
  }) => Promise<{ owner: BrainOwnerRead; secret: string }>;
  openBrain: () => void;
}
