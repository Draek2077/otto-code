import type {
  BrainConnectionRead,
  BrainCredentialSlot,
  BrainNetworkDiscovery,
  BrainOwnerRead,
  BrainRuntimeSource,
  BrainSettingsChoice,
  BrainSettingsPort,
  BrainSettingsSnapshot,
} from "./contracts";
import { BrainSettingsOperationError } from "./contracts";
import {
  acknowledgeDraft,
  connectionDraft,
  connectionErrors,
  connectionPatch,
  credentialIntent,
  keepCredential,
  ownerDraft,
  ownerErrors,
  ownerPatch,
  sameValue,
  type ConnectionDraft,
  type CredentialDraft,
  type OwnerDraft,
} from "./drafts";

interface DraftDomain<Draft, Read> {
  origin: Read;
  draft: Draft;
  blocked: boolean;
  peerChanged: boolean;
  error: string | null;
}

type ConnectionDomain = DraftDomain<ConnectionDraft, BrainConnectionRead>;
type OwnerDomain = DraftDomain<OwnerDraft, BrainOwnerRead>;
type Operation =
  | "save-connection"
  | "save-owner"
  | "reload-connection"
  | "reload-owner"
  | "generate-key"
  | "discover"
  | "start"
  | "stop"
  | "restart";
interface Activation {
  active: boolean;
  release: () => void;
}

export interface BrainSettingsFormState {
  connection: ConnectionDomain | null;
  owner: OwnerDomain | null;
  credentials: Record<BrainCredentialSlot, CredentialDraft>;
  connectionDirty: boolean;
  ownerDirty: boolean;
  connectionErrors: Partial<Record<keyof ConnectionDraft, string>>;
  ownerErrors: Partial<Record<keyof OwnerDraft, string>>;
  credentialErrors: Partial<Record<BrainCredentialSlot, string>>;
  operation: Operation | null;
  targetChanged: boolean;
  /** Direct generation result only. Never copied to the parent snapshot/store. */
  revealedKey: string | null;
  copiedKey: boolean;
  notice: string | null;
  discovery: BrainNetworkDiscovery | null;
  inputVersions: { connection: number; owner: number };
  displays: {
    runtime: BrainSettingsChoice | null;
    defaultModel: BrainSettingsChoice | null;
    locked: BrainSettingsChoice[];
  };
}

function domain<Draft, Read>(origin: Read, draft: Draft): DraftDomain<Draft, Read> {
  return { origin, draft, blocked: false, peerChanged: false, error: null };
}

const selected = (
  choices: readonly BrainSettingsChoice[],
  id: string | null,
): BrainSettingsChoice | null =>
  id === null ? null : (choices.find((choice) => choice.id === id) ?? { id, label: id });

/** One local form lifetime, with two explicit revision domains and one mutation lane. */
export class BrainSettingsFormModel {
  private snapshot: BrainSettingsSnapshot;
  private state: BrainSettingsFormState;
  private listeners = new Set<() => void>();
  private activation: Activation | null = null;
  private runtimeSelectionVersion = 0;
  private pending: { activation: Activation; operation: Operation; redactions: string[] } | null =
    null;

  constructor(private readonly port: BrainSettingsPort) {
    this.snapshot = port.getSnapshot();
    this.state = {
      connection: null,
      owner: null,
      credentials: {
        remote: keepCredential(),
        access: keepCredential(),
        huggingFace: keepCredential(),
      },
      connectionDirty: false,
      ownerDirty: false,
      connectionErrors: {},
      ownerErrors: {},
      credentialErrors: {},
      operation: null,
      targetChanged: false,
      revealedKey: null,
      copiedKey: false,
      notice: null,
      discovery: null,
      displays: { runtime: null, defaultModel: null, locked: [] },
      inputVersions: { connection: 0, owner: 0 },
    };
    this.applySnapshot(this.snapshot);
  }

  getState = (): BrainSettingsFormState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  activate(): () => void {
    if (this.activation) this.deactivate(this.activation);
    const activation: Activation = { active: true, release: this.port.retainSettings() };
    this.activation = activation;
    return () => this.deactivate(activation);
  }

  close(): void {
    if (this.activation) this.deactivate(this.activation);
    this.state = {
      ...this.state,
      revealedKey: null,
      credentials: {
        remote: keepCredential(),
        access: keepCredential(),
        huggingFace: keepCredential(),
      },
    };
    this.listeners.clear();
  }

  applySnapshot(snapshot: BrainSettingsSnapshot): void {
    // This instance belongs to its opened daemon; a caller keys the next host separately.
    if (snapshot.host.serverId !== this.snapshot.host.serverId) return;
    this.snapshot = snapshot;
    const next = { ...this.state };
    const connection = snapshot.connection.data;
    const owner = snapshot.owner.data;
    if (connection && snapshot.connection.state === "ready") {
      next.connection = next.connection
        ? {
            ...next.connection,
            peerChanged: connection.revision !== next.connection.origin.revision,
          }
        : domain(connection, connectionDraft(connection.config));
    }
    if (owner && snapshot.owner.state === "ready") {
      if (next.owner) {
        next.owner = { ...next.owner, peerChanged: owner.revision !== next.owner.origin.revision };
        next.targetChanged = owner.owner.id !== next.owner.origin.owner.id;
        if (next.targetChanged) {
          next.revealedKey = null;
          next.copiedKey = false;
          next.discovery = null;
        }
      } else {
        next.owner = domain(owner, ownerDraft(owner.config));
        next.displays = this.captureDisplays(next.owner.draft);
      }
    }
    this.publish(next);
  }

  editConnection<Key extends keyof ConnectionDraft>(key: Key, value: ConnectionDraft[Key]): void {
    if (!this.state.connection) return;
    this.publish({
      ...this.state,
      connection: {
        ...this.state.connection,
        draft: { ...this.state.connection.draft, [key]: value },
      },
    });
  }

  editOwner<Key extends keyof OwnerDraft>(key: Key, value: OwnerDraft[Key]): void {
    if (!this.state.owner) return;
    this.publish({
      ...this.state,
      owner: {
        ...this.state.owner,
        draft: { ...this.state.owner.draft, [key]: value },
      },
    });
  }

  selectModel(choice: BrainSettingsChoice | null): void {
    this.editOwner("defaultModelId", choice?.id ?? null);
    this.publish({ ...this.state, displays: { ...this.state.displays, defaultModel: choice } });
  }

  selectRuntime(choice: BrainSettingsChoice | null): void {
    const owner = this.state.owner;
    if (!owner) return;
    this.runtimeSelectionVersion++;
    // Installed IDs are opaque. The owning adapter resolves their actual source.
    this.publish({
      ...this.state,
      owner: {
        ...owner,
        draft: {
          ...owner.draft,
          runtimeSelectionId: choice?.id ?? null,
          runtimePath: "",
          runtimeSource: choice ? owner.draft.runtimeSource : "auto",
        },
      },
      displays: { ...this.state.displays, runtime: choice },
    });
  }

  selectRuntimeSource(source: BrainRuntimeSource): void {
    const owner = this.state.owner;
    if (!owner) return;
    this.runtimeSelectionVersion++;
    this.publish({
      ...this.state,
      owner: {
        ...owner,
        draft: {
          ...owner.draft,
          runtimeSource: source,
          runtimeSelectionId: null,
          runtimePath: "",
        },
      },
      displays: { ...this.state.displays, runtime: null },
    });
  }

  setRuntimePath(value: string): void {
    this.runtimeSelectionVersion++;
    this.editOwner("runtimePath", value);
    if (!value) return;
    this.editOwner("runtimeSelectionId", null);
    this.publish({ ...this.state, displays: { ...this.state.displays, runtime: null } });
  }

  selectLockedModel(index: number, choice: BrainSettingsChoice | null): void {
    const owner = this.state.owner;
    if (!owner) return;
    const ids = [...owner.draft.lockedModelIds];
    const displays = [...this.state.displays.locked];
    const position = Math.min(index, ids.length);
    if (choice) {
      ids[position] = choice.id;
      displays[position] = choice;
    } else {
      ids.splice(index, 1);
      displays.splice(index, 1);
    }
    this.editOwner("lockedModelIds", ids);
    this.publish({ ...this.state, displays: { ...this.state.displays, locked: displays } });
  }

  editCredential(slot: BrainCredentialSlot, draft: CredentialDraft): void {
    this.publish({ ...this.state, credentials: { ...this.state.credentials, [slot]: draft } });
  }

  async saveConnection(): Promise<boolean> {
    const connection = this.state.connection;
    if (
      !connection ||
      !this.state.connectionDirty ||
      connection.blocked ||
      !this.snapshot.capabilities.editConnection
    )
      return false;
    if (!this.validConnection()) return false;
    const patch = connectionPatch(connection.origin.config, connection.draft);
    const capabilities = this.snapshot.capabilities;
    if ((patch.mode || patch.remote) && !capabilities.remoteConnection) return false;
    if (this.state.credentials.remote.action !== "keep" && !capabilities.remoteCredential)
      return false;
    return this.run("save-connection", async (activation) => {
      const credentials = this.state.credentials.remote;
      const result = await this.port.saveConnection({
        expectedRevision: connection.origin.revision,
        patch,
        credential: credentialIntent(credentials),
      });
      if (!this.current(activation)) return false;
      const current = this.state.connection;
      if (!current) return false;
      this.publish({
        ...this.state,
        connection: domain(
          result,
          acknowledgeDraft(current.draft, connection.draft, connectionDraft(result.config)),
        ),
        credentials: {
          ...this.state.credentials,
          remote: sameValue(this.state.credentials.remote, credentials)
            ? keepCredential()
            : this.state.credentials.remote,
        },
        notice: "Connection settings saved",
      });
      return true;
    });
  }

  async saveOwner(): Promise<boolean> {
    const owner = this.state.owner;
    if (
      !owner ||
      !this.state.ownerDirty ||
      owner.blocked ||
      this.state.targetChanged ||
      !this.validOwner()
    )
      return false;
    const patch = ownerPatch(owner.origin.config, owner.draft);
    const runtimeSelectionVersion = this.runtimeSelectionVersion;
    if (!this.allowedOwnerPatch(patch)) {
      this.publish({
        ...this.state,
        owner: {
          ...owner,
          error: "The owner no longer permits these changes. Your draft has been kept.",
        },
      });
      return false;
    }
    return this.run("save-owner", async (activation) => {
      const access = this.state.credentials.access;
      const huggingFace = this.state.credentials.huggingFace;
      const result = await this.port.saveOwner({
        ownerId: owner.origin.owner.id,
        expectedRevision: owner.origin.revision,
        patch,
        credentials: {
          access: credentialIntent(access),
          huggingFace: credentialIntent(huggingFace),
        },
      });
      if (
        result.owner.id !== owner.origin.owner.id ||
        !this.currentOwner(activation, owner.origin.owner.id)
      )
        return false;
      const current = this.state.owner;
      if (!current) return false;
      const draft = this.acknowledgeOwnerDraft(
        current.draft,
        owner.draft,
        result,
        runtimeSelectionVersion,
      );
      this.publish({
        ...this.state,
        owner: domain(result, draft),
        displays: this.reconcileDisplays(draft),
        credentials: {
          ...this.state.credentials,
          access: sameValue(this.state.credentials.access, access)
            ? keepCredential()
            : this.state.credentials.access,
          huggingFace: sameValue(this.state.credentials.huggingFace, huggingFace)
            ? keepCredential()
            : this.state.credentials.huggingFace,
        },
        notice: result.requiresRestart
          ? "Brain settings saved. Restart explicitly to apply pending changes"
          : "Brain settings saved",
      });
      return true;
    });
  }

  async reload(scope: "connection" | "owner", confirm: () => Promise<boolean>): Promise<boolean> {
    const activation = this.activation;
    if (!activation || this.pending || !(await confirm()) || !this.current(activation))
      return false;
    return this.run(
      scope === "connection" ? "reload-connection" : "reload-owner",
      async (authority) => {
        if (scope === "connection") {
          const result = await this.port.readConnection();
          if (!this.current(authority)) return false;
          this.publish({
            ...this.state,
            connection: domain(result, connectionDraft(result.config)),
            credentials: { ...this.state.credentials, remote: keepCredential() },
            notice: null,
            inputVersions: {
              ...this.state.inputVersions,
              connection: this.state.inputVersions.connection + 1,
            },
          });
        } else {
          const ownerId = this.snapshot.owner.data?.owner.id;
          if (!ownerId) return false;
          const result = await this.port.readOwner(ownerId);
          if (result.owner.id !== ownerId || !this.currentOwner(authority, ownerId)) return false;
          const draft = ownerDraft(result.config);
          this.publish({
            ...this.state,
            owner: domain(result, draft),
            targetChanged: false,
            displays: this.captureDisplays(draft),
            credentials: {
              ...this.state.credentials,
              access: keepCredential(),
              huggingFace: keepCredential(),
            },
            revealedKey: null,
            copiedKey: false,
            notice: null,
            inputVersions: {
              ...this.state.inputVersions,
              owner: this.state.inputVersions.owner + 1,
            },
          });
        }
        return true;
      },
    );
  }

  async perform(
    action: "start" | "stop" | "restart",
    confirm: () => Promise<boolean>,
  ): Promise<boolean> {
    if (!this.canPerform(action)) return false;
    const activation = this.activation;
    const ownerId = this.state.owner?.origin.owner.id;
    if (!activation || !ownerId || !(await confirm()) || !this.currentOwner(activation, ownerId))
      return false;
    return this.run(action, async (authority) => {
      if (!this.canPerform(action)) return false;
      await this.port.performOwnerAction({ ownerId, action });
      if (!this.currentOwner(authority, ownerId)) return false;
      this.publish({ ...this.state, notice: `Brain ${action} requested` });
      return true;
    });
  }

  async generateAccessKey(confirm: () => Promise<boolean>): Promise<boolean> {
    const owner = this.state.owner;
    const activation = this.activation;
    if (!owner || !activation || !this.canGenerate()) return false;
    if (
      !(await confirm()) ||
      !this.currentOwner(activation, owner.origin.owner.id) ||
      !this.canGenerate()
    )
      return false;
    if (this.state.owner?.origin.revision !== owner.origin.revision) return false;
    const runtimeSelectionVersion = this.runtimeSelectionVersion;
    return this.run("generate-key", async (authority) => {
      const result = await this.port.generateAccessKey({
        ownerId: owner.origin.owner.id,
        expectedRevision: owner.origin.revision,
      });
      if (
        result.owner.owner.id !== owner.origin.owner.id ||
        !this.currentOwner(authority, owner.origin.owner.id)
      )
        return false;
      const currentDraft = this.state.owner?.draft ?? owner.draft;
      const draft = this.acknowledgeOwnerDraft(
        currentDraft,
        owner.draft,
        result.owner,
        runtimeSelectionVersion,
      );
      this.publish({
        ...this.state,
        owner: domain(result.owner, draft),
        displays: this.reconcileDisplays(draft),
        revealedKey: result.secret,
        copiedKey: false,
        notice: null,
      });
      return true;
    });
  }

  async copyAccessKey(copy: (secret: string) => Promise<void>): Promise<void> {
    const secret = this.state.revealedKey;
    const activation = this.activation;
    if (!secret || !activation) return;
    try {
      await copy(secret);
      if (this.current(activation) && this.state.revealedKey === secret)
        this.publish({ ...this.state, copiedKey: true });
    } catch (error) {
      if (this.current(activation))
        this.publish({ ...this.state, notice: this.errorText(error, [secret]) });
    }
  }

  hideAccessKey(): void {
    this.publish({ ...this.state, revealedKey: null, copiedKey: false });
  }

  async discoverNetwork(): Promise<boolean> {
    const ownerId = this.state.owner?.origin.owner.id;
    if (!ownerId || !this.snapshot.capabilities.discoverNetwork) return false;
    return this.run("discover", async (activation) => {
      const result = await this.port.discoverNetwork(ownerId);
      if (!this.currentOwner(activation, ownerId) || result.ownerId !== ownerId) return false;
      this.publish({ ...this.state, discovery: result });
      return true;
    });
  }

  applyDiscoveredTls(): void {
    const tailscale = this.state.discovery?.tailscale;
    if (!tailscale?.available) return;
    if (tailscale.hostname) this.editOwner("hostname", tailscale.hostname);
    if (tailscale.certificateDirectory)
      this.editOwner("certDirectory", tailscale.certificateDirectory);
  }

  private acknowledgeOwnerDraft(
    current: OwnerDraft,
    submitted: OwnerDraft,
    accepted: BrainOwnerRead,
    runtimeSelectionVersion: number,
  ): OwnerDraft {
    const draft = acknowledgeDraft(current, submitted, ownerDraft(accepted.config));
    if (this.runtimeSelectionVersion === runtimeSelectionVersion) return draft;
    // A newer explicit policy can equal its old text value while clearing a pin.
    // Keep its runtime selection together instead of reviving normalized pins/paths.
    return {
      ...draft,
      runtimeSource: current.runtimeSource,
      runtimeSelectionId: current.runtimeSelectionId,
      runtimePath: current.runtimePath,
    };
  }

  private captureDisplays(draft: OwnerDraft): BrainSettingsFormState["displays"] {
    return {
      runtime: selected(this.snapshot.choices.runtimes, draft.runtimeSelectionId),
      defaultModel: selected(this.snapshot.choices.models, draft.defaultModelId),
      locked: draft.lockedModelIds.map(
        (id) => selected(this.snapshot.choices.models, id) ?? { id, label: id },
      ),
    };
  }

  private reconcileDisplays(draft: OwnerDraft): BrainSettingsFormState["displays"] {
    const displays = this.state.displays;
    return {
      runtime:
        (displays.runtime?.id ?? null) === draft.runtimeSelectionId
          ? displays.runtime
          : selected(this.snapshot.choices.runtimes, draft.runtimeSelectionId),
      defaultModel:
        (displays.defaultModel?.id ?? null) === draft.defaultModelId
          ? displays.defaultModel
          : selected(this.snapshot.choices.models, draft.defaultModelId),
      locked: draft.lockedModelIds.map(
        (id) =>
          displays.locked.find((choice) => choice.id === id) ??
          selected(this.snapshot.choices.models, id) ?? { id, label: id },
      ),
    };
  }

  private current(activation: Activation): boolean {
    return activation.active && this.activation === activation;
  }

  private deactivate(activation: Activation): void {
    if (activation.active) {
      activation.active = false;
      activation.release();
    }
    if (this.activation !== activation) return;
    this.activation = null;
    this.invalidatePendingWrite();
    this.publish({ ...this.state, revealedKey: null, copiedKey: false });
  }

  private currentOwner(activation: Activation, ownerId: string): boolean {
    return this.current(activation) && this.snapshot.owner.data?.owner.id === ownerId;
  }

  private canGenerate(): boolean {
    return (
      this.snapshot.capabilities.generateAccessKey &&
      !this.pending &&
      !this.state.ownerDirty &&
      !this.state.connectionDirty &&
      !this.state.owner?.blocked &&
      !this.state.targetChanged
    );
  }

  private canPerform(action: "start" | "stop" | "restart"): boolean {
    return (
      this.snapshot.capabilities.lifecycle[action] &&
      !this.state.connectionDirty &&
      !this.state.ownerDirty &&
      !this.state.owner?.blocked &&
      !this.state.targetChanged
    );
  }

  private validConnection(): boolean {
    const connection = this.state.connection;
    if (!connection) return false;
    const errors = connectionErrors(connection.draft, connectionDraft(connection.origin.config));
    const credentialErrors = this.validateCredentials(["remote"]);
    this.publish({
      ...this.state,
      connectionErrors: errors,
      credentialErrors,
      connection: {
        ...connection,
        error:
          Object.keys(errors).length || Object.keys(credentialErrors).length
            ? "Review the marked connection fields"
            : null,
      },
    });
    return Object.keys(errors).length === 0 && Object.keys(credentialErrors).length === 0;
  }

  private validOwner(): boolean {
    const owner = this.state.owner;
    if (!owner) return false;
    const errors = ownerErrors(owner.draft, ownerDraft(owner.origin.config));
    const credentialErrors = this.validateCredentials(["access", "huggingFace"]);
    this.publish({
      ...this.state,
      ownerErrors: errors,
      credentialErrors,
      owner: {
        ...owner,
        error:
          Object.keys(errors).length || Object.keys(credentialErrors).length
            ? "Review the marked Brain settings fields"
            : null,
      },
    });
    return Object.keys(errors).length === 0 && Object.keys(credentialErrors).length === 0;
  }

  private validateCredentials(
    slots: BrainCredentialSlot[],
  ): BrainSettingsFormState["credentialErrors"] {
    const errors: BrainSettingsFormState["credentialErrors"] = {};
    for (const slot of slots) {
      const draft = this.state.credentials[slot];
      if (draft.action === "replace" && !draft.value.trim())
        errors[slot] = "Enter a replacement or keep the existing credential";
    }
    return errors;
  }

  private allowedRuntimePatch(runtime: ReturnType<typeof ownerPatch>["runtime"]): boolean {
    if (!runtime) return true;
    const capabilities = this.snapshot.capabilities;
    if (
      (runtime.source !== undefined ||
        runtime.selectionId !== undefined ||
        runtime.executablePath !== undefined) &&
      !capabilities.runtime
    )
      return false;
    return runtime.logVerbosity === undefined || capabilities.logging;
  }

  private allowedOwnerPatch(patch: ReturnType<typeof ownerPatch>): boolean {
    const capabilities = this.snapshot.capabilities;
    if (!this.allowedRuntimePatch(patch.runtime)) return false;
    if (patch.storage && !capabilities.storage) return false;
    if (patch.defaults && !capabilities.defaults) return false;
    if (patch.residency && !capabilities.residency) return false;
    if (patch.access && !capabilities.access) return false;
    if (patch.tls && !capabilities.tls) return false;
    if (this.state.credentials.access.action !== "keep" && !capabilities.accessCredential)
      return false;
    return (
      this.state.credentials.huggingFace.action === "keep" || capabilities.huggingFaceCredential
    );
  }

  private invalidatePendingWrite(): void {
    if (!this.pending) return;
    const operation = this.pending.operation;
    if (operation === "save-connection" && this.state.connection) {
      this.state = {
        ...this.state,
        connection: { ...this.state.connection, blocked: true, peerChanged: true },
      };
    }
    if ((operation === "save-owner" || operation === "generate-key") && this.state.owner) {
      this.state = {
        ...this.state,
        owner: { ...this.state.owner, blocked: true, peerChanged: true },
      };
    }
  }

  private async run(
    operation: Operation,
    work: (activation: Activation) => Promise<boolean>,
  ): Promise<boolean> {
    const activation = this.activation;
    if (!activation || this.pending || !this.snapshot.host.connected) return false;
    this.pending = {
      activation,
      operation,
      redactions: [
        ...Object.values(this.state.credentials).map((credential) => credential.value),
        this.state.revealedKey ?? "",
      ],
    };
    this.publish({
      ...this.state,
      operation,
      notice: null,
      revealedKey: operation === "generate-key" ? null : this.state.revealedKey,
      copiedKey: operation === "generate-key" ? false : this.state.copiedKey,
    });
    try {
      return await work(activation);
    } catch (error) {
      if (this.current(activation)) this.fail(operation, error);
      return false;
    } finally {
      this.pending = null;
      this.publish({ ...this.state, operation: null });
    }
  }

  private fail(operation: Operation, error: unknown): void {
    const message = this.errorText(error);
    const validationRejected =
      error instanceof BrainSettingsOperationError && error.kind === "validation";
    if (operation === "save-connection" || operation === "reload-connection") {
      const connection = this.state.connection;
      if (connection)
        this.publish({
          ...this.state,
          connection: {
            ...connection,
            blocked: operation !== "save-connection" || !validationRejected,
            error: message,
          },
        });
      else this.publish({ ...this.state, notice: message });
    } else if (
      operation === "save-owner" ||
      operation === "reload-owner" ||
      operation === "generate-key"
    ) {
      const owner = this.state.owner;
      if (owner)
        this.publish({
          ...this.state,
          owner: {
            ...owner,
            blocked: operation !== "save-owner" || !validationRejected,
            error: message,
          },
        });
      else this.publish({ ...this.state, notice: message });
    } else this.publish({ ...this.state, notice: message });
  }

  private errorText(error: unknown, extraRedactions: readonly string[] = []): string {
    let message = error instanceof Error ? error.message : String(error);
    for (const credential of Object.values(this.state.credentials)) {
      if (credential.value) message = message.split(credential.value).join("[redacted]");
    }
    for (const secret of this.pending?.redactions ?? []) {
      if (secret) message = message.split(secret).join("[redacted]");
    }
    for (const secret of extraRedactions) {
      if (secret) message = message.split(secret).join("[redacted]");
    }
    if (this.state.revealedKey) message = message.split(this.state.revealedKey).join("[redacted]");
    return message;
  }

  private publish(next: BrainSettingsFormState): void {
    this.state = {
      ...next,
      connectionDirty:
        next.connection !== null &&
        (!sameValue(next.connection.draft, connectionDraft(next.connection.origin.config)) ||
          next.credentials.remote.action !== "keep"),
      ownerDirty:
        next.owner !== null &&
        (!sameValue(next.owner.draft, ownerDraft(next.owner.origin.config)) ||
          next.credentials.access.action !== "keep" ||
          next.credentials.huggingFace.action !== "keep"),
    };
    for (const listener of this.listeners) listener();
  }
}

export const openBrainSettingsForm = (port: BrainSettingsPort): BrainSettingsFormModel =>
  new BrainSettingsFormModel(port);
