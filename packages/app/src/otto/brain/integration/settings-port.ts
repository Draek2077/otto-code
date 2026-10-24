import { z } from "zod";
import { BrainOwnerReadSchema, BrainNetworkDiscoverySchema } from "@getpaseo/protocol/otto/brain";
import {
  BrainSettingsOperationError,
  type BrainSettingsPort,
  type BrainSettingsSnapshot,
  type BrainSettingsResource,
} from "../settings/contracts";
import { BrainConnectionState, type BrainConnectionStateSnapshot } from "./connection-state";
import { ownerToForm, ownerPatchToHost } from "./owner-mapping";

function resource<T>(data: T | null, error: string | null): BrainSettingsResource<T> {
  if (error) return { state: "error", data, message: error };
  return data === null ? { state: "loading", data } : { state: "ready", data };
}
type SettingsPhase = BrainSettingsSnapshot["status"]["phase"];
function connectedPhase(state: BrainConnectionStateSnapshot): SettingsPhase {
  const host = state.feed?.status;
  if (host?.state === "failed") return "failed";
  if (host?.running) return "running";
  return "starting";
}
function localPhase(state: BrainConnectionStateSnapshot): SettingsPhase {
  if (state.feed?.connection === "connected") return connectedPhase(state);
  if (!state.localRunning) return "stopped";
  return state.feed?.connection === "disconnected" ? "unreachable" : "starting";
}
function remotePhase(state: BrainConnectionStateSnapshot): SettingsPhase {
  if (state.feed?.connection === "connected") return connectedPhase(state);
  if (state.ownerError || state.feed?.connection === "disconnected") return "unreachable";
  return "connecting";
}
function phase(state: BrainConnectionStateSnapshot): SettingsPhase {
  if (state.connection?.config.enabled === false) return "disabled";
  if (!state.connected) return state.loading ? "connecting" : "unreachable";
  return state.connection?.config.mode === "remote" ? remotePhase(state) : localPhase(state);
}
function ownerPermissions(state: BrainConnectionStateSnapshot, write: boolean) {
  if (!write || !state.owner)
    return {
      runtime: false,
      storage: false,
      logging: false,
      defaults: false,
      residency: false,
      access: false,
      tls: false,
      accessCredential: false,
      huggingFaceCredential: false,
      discoverNetwork: false,
      generateAccessKey: false,
    };
  const permission = state.owner.capabilities;
  return {
    runtime: permission.runtimeSelection,
    storage: permission.storage,
    logging: true,
    defaults: true,
    residency: true,
    access: true,
    tls: true,
    accessCredential: permission.accessCredential,
    huggingFaceCredential: permission.huggingFaceCredential,
    discoverNetwork: permission.networkDiscovery,
    generateAccessKey: permission.accessCredential,
  };
}
function lifecyclePermissions(state: BrainConnectionStateSnapshot, write: boolean) {
  const local = state.connection?.config.mode === "local";
  return {
    start: write && local && state.connection?.config.enabled === true && !state.localRunning,
    stop: write && local && state.localRunning,
    restart:
      write && (local ? state.localRunning : state.feed?.status?.capabilities.restart === true),
  };
}
function capabilities(state: BrainConnectionStateSnapshot): BrainSettingsSnapshot["capabilities"] {
  const owner = state.owner;
  const local = state.connection?.config.mode === "local";
  const write =
    state.connected &&
    owner !== null &&
    (local ||
      (state.feed?.connection === "connected" &&
        state.feed.status?.capabilities.writable === true));
  const supported = owner !== null;
  return {
    supported: {
      runtime: supported,
      storage: supported,
      defaults: supported,
      residency: supported,
      access: supported,
      tls: supported,
      logging: supported,
    },
    editConnection: state.connected,
    remoteConnection: state.connected,
    remoteCredential: state.connected,
    ...ownerPermissions(state, write),
    lifecycle: lifecyclePermissions(state, write),
  };
}
const Accepted = z.object({ accepted: z.literal(true) });
const Generated = z.object({ owner: BrainOwnerReadSchema, secret: z.string().min(1).max(16384) });
const EmptyChoices = { models: [], runtimes: [], cacheTypes: [] };
function status(state: BrainConnectionStateSnapshot): BrainSettingsSnapshot["status"] {
  return {
    phase: phase(state),
    version: state.feed?.status?.version ?? null,
    endpoint: state.endpoint,
    modelLabel: state.feed?.status?.model ?? null,
    message: state.ownerError ?? state.error?.message ?? null,
  };
}

/** A form-facing view of the canonical per-installation connection, not a second cache. */
export class BrainSettingsFacade implements BrainSettingsPort {
  readonly version = 1;
  private snapshot: BrainSettingsSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  constructor(
    private readonly core: BrainConnectionState,
    private readonly host: { serverId: string; label: string },
    readonly openBrain: () => void,
  ) {
    this.snapshot = this.project();
    this.unsubscribe = core.subscribe(() => {
      this.snapshot = this.project();
      for (const listener of this.listeners) listener();
    });
  }
  private project(): BrainSettingsSnapshot {
    const state = this.core.getSnapshot();
    const mode = state.connection?.config.mode ?? "local";
    const owner = state.owner ? ownerToForm(state.owner, mode) : null;
    const error = state.error?.message ?? null;
    return {
      version: 1,
      host: { ...this.host, connected: state.connected },
      connection: resource(state.connection, error),
      owner: resource(owner, state.ownerError ?? error),
      status: status(state),
      capabilities: capabilities(state),
      choices: { ...(state.owner?.choices ?? EmptyChoices), bindAddresses: [] },
    };
  }
  getSnapshot = () => this.snapshot;
  setHostLabel(label: string): void {
    if (this.snapshot.host.label === label) return;
    this.host.label = label;
    this.snapshot = this.project();
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  retainSettings = () => this.core.retain();
  readConnection = () => this.core.readConnection();
  saveConnection: BrainSettingsPort["saveConnection"] = (input) => this.core.saveConnection(input);
  private origin(ownerId: string) {
    const state = this.core.getSnapshot();
    if (state.owner?.ownerId !== ownerId || !state.connection)
      throw new BrainSettingsOperationError(
        "conflict",
        "The selected Brain owner changed. Reload its settings before continuing.",
      );
    return { revision: state.connection.revision, mode: state.connection.config.mode };
  }
  readOwner: BrainSettingsPort["readOwner"] = async (ownerId) => {
    const { revision, mode } = this.origin(ownerId);
    const owner = await this.core.rpc.request(
      "brain.owner.read",
      { ownerId },
      BrainOwnerReadSchema,
    );
    this.core.acceptOwner(owner, revision);
    return ownerToForm(owner, mode);
  };
  saveOwner: BrainSettingsPort["saveOwner"] = async (input) => {
    const { revision, mode } = this.origin(input.ownerId);
    const owner = await this.core.rpc.request(
      "brain.owner.save",
      { ...input, patch: ownerPatchToHost(input.patch) },
      BrainOwnerReadSchema,
    );
    this.core.acceptOwner(owner, revision);
    return ownerToForm(owner, mode);
  };
  performOwnerAction: BrainSettingsPort["performOwnerAction"] = async (input) => {
    this.origin(input.ownerId);
    await this.core.rpc.request(
      "brain.lifecycle",
      { action: input.action, modelId: null },
      Accepted,
    );
    await this.core.refresh();
  };
  generateAccessKey: BrainSettingsPort["generateAccessKey"] = async (input) => {
    const { revision, mode } = this.origin(input.ownerId);
    const result = await this.core.rpc.request("brain.owner.generate_key", input, Generated);
    this.core.acceptOwner(result.owner, revision);
    return { owner: ownerToForm(result.owner, mode), secret: result.secret };
  };
  discoverNetwork: BrainSettingsPort["discoverNetwork"] = async (ownerId) => {
    const { revision } = this.origin(ownerId);
    const result = await this.core.rpc.request(
      "brain.owner.discover_network",
      { ownerId },
      BrainNetworkDiscoverySchema,
    );
    if (result.ownerId !== ownerId || this.core.getSnapshot().connection?.revision !== revision)
      throw new BrainSettingsOperationError(
        "conflict",
        "The selected Brain owner changed during discovery. Reload before continuing.",
      );
    return result;
  };
  close(): void {
    this.unsubscribe();
    this.listeners.clear();
  }
}
