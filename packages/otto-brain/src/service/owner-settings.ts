/** Revisioned persisted owner settings. Saving never launches, restarts, or unloads a model. */
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { BrainConfig } from "../config/schema.js";
import { BrainConfigSchema } from "../config/schema.js";
import { applyEnvOverrides } from "../config/env.js";
import {
  BrainConfigWriteError,
  readBrainConfigRevision,
  updateBrainConfig,
  type BrainConfigRevision,
} from "../config/revision-store.js";
import type { Runtime } from "../types.js";
import type { BrainRuntimeContext } from "./serve.js";
import { runtimeIdentity } from "./runtime-management.js";
import {
  OwnerSettingsError,
  OwnerSettingsGenerateSchema,
  OwnerSettingsSaveSchema,
  type OwnerSettingsSave,
  type OwnerCredentialIntent,
} from "./owner-settings-contract.js";

interface OwnerSettingsPorts {
  runtimes(): Runtime[];
  resolve(config: BrainConfig): Runtime | null;
  changed(): void;
  label?: string;
}
function credential(
  current: string | null,
  intent: OwnerCredentialIntent | undefined,
): string | null {
  if (!intent || intent.action === "keep") return current;
  return intent.action === "remove" ? null : intent.value;
}
function credentialStatus(stored: string | null, environment: string | undefined) {
  let effectiveSource: "none" | "stored" | "environment" = "none";
  if (environment) effectiveSource = "environment";
  else if (stored) effectiveSource = "stored";
  return { stored: Boolean(stored), effectiveSource };
}
function changesCredential(intent: OwnerCredentialIntent | undefined): boolean {
  return intent !== undefined && intent.action !== "keep";
}

export class BrainOwnerSettings {
  readonly ownerId: string;
  constructor(
    readonly context: BrainRuntimeContext,
    private readonly ports: OwnerSettingsPorts,
  ) {
    this.ownerId = `brain-owner/${createHash("sha256").update(context.paths.root).digest("hex")}`;
  }
  read() {
    return this.project(readBrainConfigRevision(this.context.paths));
  }

  private project(snapshot: BrainConfigRevision) {
    const { config, revision } = snapshot;
    const { auth, hfToken, ...visible } = config;
    const effective = applyEnvOverrides(config, this.context.env);
    let runtime: Runtime | null;
    try {
      runtime = this.ports.resolve(effective);
    } catch {
      runtime = null;
    }
    const selected = config.runtime.path
      ? this.ports.runtimes().find((entry) => entry.exe === config.runtime.path)
      : null;
    return {
      version: 1 as const,
      ownerId: this.ownerId,
      ownerLabel: this.ports.label ?? hostname(),
      revision,
      config: {
        ...visible,
        auth: { mode: auth.mode },
        runtime: { ...config.runtime, selectionId: selected ? runtimeIdentity(selected) : null },
      },
      credentials: {
        access: credentialStatus(auth.token, this.context.env.OTTO_BRAIN_TOKEN),
        huggingFace: credentialStatus(
          hfToken,
          this.context.env.HF_TOKEN || this.context.env.HUGGING_FACE_HUB_TOKEN,
        ),
      },
      resolved: {
        runtimeLabel: runtime?.displayName ?? runtime?.label ?? null,
        executablePath: runtime?.exe ?? null,
      },
      requiresRestart: JSON.stringify(effective) !== JSON.stringify(this.context.config),
      capabilities: {
        runtimeSelection: !this.context.env.OTTO_BRAIN_LLAMA_SERVER,
        storage: !this.context.env.OTTO_BRAIN_MODELS_DIR,
        accessCredential: !this.context.env.OTTO_BRAIN_TOKEN,
        huggingFaceCredential: !(
          this.context.env.HF_TOKEN || this.context.env.HUGGING_FACE_HUB_TOKEN
        ),
      },
    };
  }

  save(input: unknown) {
    const parsed = OwnerSettingsSaveSchema.safeParse(input);
    if (!parsed.success)
      throw new OwnerSettingsError("validation", "Invalid Brain settings fields");
    const request = parsed.data;
    this.assertOwner(request.ownerId);
    const origin = readBrainConfigRevision(this.context.paths);
    if (origin.revision !== request.expectedRevision)
      throw new OwnerSettingsError("conflict", "Brain settings changed; reload before saving");
    this.assertEnvironment(request);
    const next = this.prepare(origin.config, request);
    let saved: BrainConfigRevision;
    try {
      saved = updateBrainConfig(request.expectedRevision, () => next, this.context.paths);
    } catch (error) {
      if (error instanceof BrainConfigWriteError)
        throw new OwnerSettingsError(
          error.kind === "conflict" ? "conflict" : "unavailable",
          error.message,
          { cause: error },
        );
      throw new OwnerSettingsError(
        "unknown",
        "Brain settings could not be saved; reload to check the host",
        { cause: error },
      );
    }
    this.ports.changed();
    return this.project(saved);
  }

  generateAccessKey(input: unknown) {
    const parsed = OwnerSettingsGenerateSchema.safeParse(input);
    if (!parsed.success)
      throw new OwnerSettingsError("validation", "An owner and settings revision are required");
    const secret = randomBytes(24).toString("base64url");
    const owner = this.save({
      ...parsed.data,
      patch: { auth: { mode: "token" } },
      credentials: { access: { action: "replace", value: secret } },
    });
    return { owner, secret };
  }

  private assertOwner(ownerId: string): void {
    if (ownerId !== this.ownerId)
      throw new OwnerSettingsError("conflict", "The Brain settings owner changed");
  }
  private assertEnvironment(request: OwnerSettingsSave): void {
    const { env } = this.context;
    const runtime = request.patch.runtime;
    if (
      env.OTTO_BRAIN_LLAMA_SERVER &&
      runtime &&
      (runtime.path !== undefined ||
        runtime.source !== undefined ||
        runtime.selectionId !== undefined)
    )
      throw new OwnerSettingsError(
        "validation",
        "Runtime selection is controlled by the host environment",
      );
    if (env.OTTO_BRAIN_MODELS_DIR && request.patch.modelsDir !== undefined)
      throw new OwnerSettingsError(
        "validation",
        "Model storage is controlled by the host environment",
      );
    if (env.OTTO_BRAIN_TOKEN && changesCredential(request.credentials?.access))
      throw new OwnerSettingsError(
        "validation",
        "The access key is controlled by the host environment",
      );
    if (
      (env.HF_TOKEN || env.HUGGING_FACE_HUB_TOKEN) &&
      changesCredential(request.credentials?.huggingFace)
    )
      throw new OwnerSettingsError(
        "validation",
        "The Hugging Face key is controlled by the host environment",
      );
  }

  private prepare(current: BrainConfig, request: OwnerSettingsSave): BrainConfig {
    const { patch } = request;
    const { selectionId, ...runtime } = patch.runtime ?? {};
    if (selectionId !== undefined) {
      if (selectionId !== null && runtime.path)
        throw new OwnerSettingsError(
          "validation",
          "Choose an installed runtime or an executable override",
        );
      if (selectionId === null) runtime.path ??= null;
      else {
        const selected = this.ports
          .runtimes()
          .find((entry) => runtimeIdentity(entry) === selectionId);
        if (!selected)
          throw new OwnerSettingsError(
            "validation",
            "The installed runtime choice is no longer available",
          );
        runtime.source = selected.source;
        runtime.path = selected.exe;
      }
    }
    const next = BrainConfigSchema.parse({
      ...current,
      ...patch,
      runtime: { ...current.runtime, ...runtime },
      listen: { ...current.listen, ...patch.listen },
      tls: { ...current.tls, ...patch.tls },
      defaults: { ...current.defaults, ...patch.defaults },
      auth: {
        ...current.auth,
        ...patch.auth,
        token: credential(current.auth.token, request.credentials?.access),
      },
      hfToken: credential(current.hfToken, request.credentials?.huggingFace),
    });
    validateOwnerPolicy(
      applyEnvOverrides(current, this.context.env),
      applyEnvOverrides(next, this.context.env),
    );
    return next;
  }
}
function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}
function validateOwnerPolicy(current: BrainConfig, next: BrainConfig): void {
  const accessChanged = changed(
    [current.auth, current.listen, current.allowInsecureBind],
    [next.auth, next.listen, next.allowInsecureBind],
  );
  if (accessChanged && next.auth.mode === "token" && !next.auth.token)
    throw new OwnerSettingsError("validation", "Token access requires a stored access key");
  if (
    changed(
      [current.lockModel, current.lockedModels, current.maxLoadedModels],
      [next.lockModel, next.lockedModels, next.maxLoadedModels],
    ) &&
    next.lockModel &&
    next.lockedModels.length > next.maxLoadedModels
  )
    throw new OwnerSettingsError("validation", "The locked model set exceeds the process limit");
  if (
    changed(current.tls, next.tls) &&
    next.tls.mode === "files" &&
    (!next.tls.certFile || !next.tls.keyFile)
  )
    throw new OwnerSettingsError(
      "validation",
      "File TLS requires certificate and key paths on the owner",
    );
  if (
    accessChanged &&
    !new Set(["localhost", "127.0.0.1", "::1"]).has(next.listen.host) &&
    next.auth.mode === "none" &&
    !next.allowInsecureBind
  )
    throw new OwnerSettingsError(
      "validation",
      "An open network bind requires explicit insecure access consent",
    );
}
export type BrainOwnerSettingsRead = ReturnType<BrainOwnerSettings["read"]>;
