/** Adapt shared configuration commands to the two actual revision domains. No runtime admission. */
import {
  BrainBootstrapSchema,
  BrainConnectionReadSchema,
  BrainConnectionSaveSchema,
  BrainOwnerReadSchema,
  type BrainOwnerRead,
} from "@getpaseo/protocol/otto/brain";
import { BrainConfigSchema, type BrainConfig } from "@getpaseo/brain/config";
import {
  applyConfigKey,
  selectedConfigValue,
  parseConfigBoolean,
  OwnerSettingsSaveSchema,
  type BrainSettingsCommandTarget,
} from "@getpaseo/brain/cli-target";
import { BrainCliError, decodeBrainEnvelope } from "./rpc.js";
import type { BrainRpcClient } from "./owner-rpc.js";

type Bootstrap = ReturnType<typeof BrainBootstrapSchema.parse>;
type Connection = ReturnType<typeof BrainConnectionReadSchema.parse>;
interface Decoder<T> {
  parse(value: unknown): T;
}

function configProjection(connection: Connection, owner: BrainOwnerRead): BrainConfig {
  const runtime = owner.config.runtime;
  return BrainConfigSchema.parse({
    ...owner.config,
    version: 1,
    enabled: connection.config.enabled,
    autoStart: connection.config.autoStart,
    runtime: { source: runtime.source, path: runtime.path, logVerbosity: runtime.logVerbosity },
    // Presentation only. Saves below extract exactly one validated leaf; these
    // placeholders can never be sent back as credential replacements.
    auth: {
      mode: owner.config.auth.mode,
      token: owner.credentials.access.effectiveSource === "none" ? null : "********",
    },
    hfToken: owner.credentials.huggingFace.effectiveSource === "none" ? null : "********",
  });
}
function requiredOwner(snapshot: Bootstrap): BrainOwnerRead {
  if (!snapshot.owner)
    throw new BrainCliError(
      "BRAIN_UNAVAILABLE",
      "The Brain owner's settings are unavailable. Connection settings remain available through `brain connection show`.",
    );
  return snapshot.owner;
}
function ownerEdit(owner: BrainOwnerRead, key: string, value: unknown) {
  const identity = { ownerId: owner.ownerId, expectedRevision: owner.revision };
  if (key === "auth.token" || key === "hfToken") {
    const name = key === "auth.token" ? "access" : "huggingFace";
    const intent = value === null ? { action: "remove" } : { action: "replace", value };
    return OwnerSettingsSaveSchema.parse({
      ...identity,
      patch: {},
      credentials: { [name]: intent },
    });
  }
  const [group, field] = key.split(".");
  let patch: Record<string, unknown> =
    field === undefined ? { [key]: value } : { [group!]: { [field]: value } };
  if (group === "runtime" && (field === "path" || field === "source")) {
    const runtime = field === "source" ? { source: value, path: null } : { path: value };
    patch = { runtime: { ...runtime, selectionId: null } };
  }
  return OwnerSettingsSaveSchema.parse({ ...identity, patch });
}

export function daemonBrainSettings(client: BrainRpcClient): BrainSettingsCommandTarget {
  // COMPAT(ottoBrainSettingsCli): added in v0.10.0; remove after 2027-04-24 when floor >= v0.10.0.
  if (client.getLastServerInfoMessage()?.features?.ottoBrain !== true)
    throw new BrainCliError("DAEMON_UPDATE_REQUIRED", "Update the host to configure Otto Brain.");
  async function invoke<T>(method: string, input: unknown, output: Decoder<T>): Promise<T> {
    try {
      return output.parse(
        decodeBrainEnvelope(await client.invokePluginRpc("otto-brain", method, input)),
      );
    } catch (error) {
      if (error instanceof BrainCliError) throw error;
      throw new BrainCliError(
        "BRAIN_UNCONFIRMED",
        "The Brain settings operation could not be confirmed. Read its current state before retrying.",
        { cause: error },
      );
    }
  }
  const read = () => invoke("brain.bootstrap", {}, BrainBootstrapSchema);
  return {
    async readConfig() {
      const snapshot = await read();
      return configProjection(snapshot.connection, requiredOwner(snapshot));
    },
    async setConfig(key, raw) {
      if (key === "enabled" || key === "autoStart") {
        const value = parseConfigBoolean(raw);
        const origin = await invoke("brain.connection.read", {}, BrainConnectionReadSchema);
        const connection = await invoke(
          "brain.connection.save",
          BrainConnectionSaveSchema.parse({
            expectedRevision: origin.revision,
            patch: { [key]: value },
            credential: { action: "keep" },
          }),
          BrainConnectionReadSchema,
        );
        return { connection };
      }
      const origin = await read();
      const owner = requiredOwner(origin);
      const candidate = applyConfigKey(configProjection(origin.connection, owner), key, raw);
      const mutation = ownerEdit(owner, key, selectedConfigValue(candidate, key));
      const current = await invoke("brain.connection.read", {}, BrainConnectionReadSchema);
      if (current.revision !== origin.connection.revision)
        throw new BrainCliError(
          "BRAIN_CONFLICT",
          "The Brain connection changed. Read its settings before saving again.",
        );
      const saved = await invoke("brain.owner.save", mutation, BrainOwnerReadSchema);
      if (saved.ownerId !== owner.ownerId)
        throw new BrainCliError(
          "BRAIN_UNCONFIRMED",
          "The Brain owner changed. Read its settings before saving again.",
        );
      return configProjection(origin.connection, saved);
    },
  };
}
