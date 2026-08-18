/**
 * The brain's management API: everything Otto's Brain page needs that is not
 * inference.
 *
 * This is deliberately served by the brain rather than driven by the daemon
 * shelling out to the CLI. The daemon's `BrainOpsManager` runs `otto-brain
 * <verb> --json`, which is local-only by construction, so every capability built
 * that way needs a second implementation before a remote brain can have it. The
 * daemon already resolves this endpoint by mode (local child or remote host), so
 * a capability added here works the same in both without a branch anywhere.
 *
 * Model ids are relative file paths and therefore contain slashes, so the
 * model-scoped routes take `?id=` rather than a path segment. Encoding a slash
 * as %2F inside a path is the kind of thing an intermediary silently normalises,
 * and the failure would look like "model not found" rather than a routing bug.
 *
 * Writes are gated on the same `allowRemoteConfig` flag as POST /__host/config.
 * A brain that may be *used* over the network is not thereby a brain whose model
 * files may be deleted over the network.
 */
import type http from "node:http";
import { randomUUID } from "node:crypto";

import {
  calibrationInfo,
  profileFieldDescriptors,
  profileWarnings,
  sanitizeProfilePatch,
} from "../config/profile-edit.js";
import {
  familyHostingProfileId,
  hostingFamily,
  removeHostingProfileMaterialization,
} from "../config/hosting-profiles.js";
import { forModel, getCalibration, put } from "../config/profiles.js";
import {
  HostingProfileSchema,
  type HostingProfile,
  type Profile,
  type ProfileDefaults,
  type ProfilesStore,
} from "../config/schema.js";
import {
  deleteComponentFile,
  deleteModelFiles,
  diskUsage,
  planDelete,
  totalModelBytes,
} from "../models/manage.js";
import { deleteDisplayName, updateDisplayName } from "../models/rename-map.js";
import type { RankedModel } from "../ops/results.js";
import type { GpuInfo, Model } from "../types.js";
import { runtimeBuild } from "../runtime/index.js";
import * as vram from "../vram.js";
import type { SystemSample } from "../sysmon.js";
import { errorMessage, readJsonBody, sendError, sendJson } from "./http-util.js";
import type {
  BrainLogPublisher,
  BrainStatusPublisher,
  BrainStatusSnapshot,
} from "./status-events.js";
import type { Supervisor } from "./supervisor.js";
import type { Scheduler } from "./scheduler.js";
import type { BrainRunLog } from "./run-log.js";
import type { BrainLogArea } from "./log-format.js";

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_DISPLAY_NAME = 200;
const MAX_HOSTING_PROFILE_NAME = 80;
const MAX_HOSTING_PROFILE_TEXT = 128 * 1024;
const MAX_HOSTING_PROFILES = 100;
const MAX_HOSTING_PROFILE_ID = 80;
const HOSTING_PROFILE_ID = /^[a-zA-Z0-9_-]+$/u;
// Keep product-owned records immutable through this API. Their source lives in
// builtin-hosting-profiles.ts, so an update would otherwise look successful but
// be replaced at the next Brain start with no user-facing restore action.
const BUILTIN_HOSTING_PROFILE_IDS = new Set(["qwen-sharp-v21.3"]);
const DEFAULT_LOG_LINES = 200;

/**
 * The management API's own version, additive to the capability flags.
 *
 * Capabilities answer "can this brain do X"; this answers "which generation of
 * the API is this" for the rare change that no single flag describes. A daemon
 * reads both and never requires an exact package-version match.
 */
export const HOST_API_VERSION = 3;

/**
 * How often the SSE stream writes a comment line when nothing has changed.
 *
 * This is transport keepalive, not a status event: a proxy or a NAT table with
 * an idle timeout would otherwise silently drop a stream from a brain that is
 * simply sitting still, and the daemon would report an unreachable brain that is
 * fine. Comments are ignored by every SSE parser, so no reader sees them.
 */
const SSE_KEEPALIVE_MS = 20_000;

/**
 * What this brain can serve. The daemon folds this into `brain.host.status` and
 * Otto gates each tab on it, because the daemon and the brain version
 * independently: a current daemon can be pointed at an older brain, and the
 * honest answer is "update the brain on that host", not a degraded reimplementation.
 */
export interface HostCapabilities {
  /** GET/POST /__host/model/profile */
  profiles: boolean;
  /** GET /__host/model/budget */
  budget: boolean;
  /** GET /__host/logs */
  logs: boolean;
  /** DELETE /__host/model */
  delete: boolean;
  /** POST /__host/model/load and /__host/model/unload */
  load: boolean;
  /** The `resources` block on /__host/status */
  resources: boolean;
  /** GET /__host/models */
  inventory: boolean;
  /** POST /__host/model/rename */
  rename: boolean;
  /** POST /__host/model/rename/reset */
  reset: boolean;
  /**
   * GET /__host/events: a live SSE stream of complete status snapshots.
   *
   * The one capability a daemon reads *before* deciding how to watch this brain.
   * False (including on every brain that predates the stream) means the daemon
   * keeps polling `/__host/status`, which is why nothing about the older
   * management API had to change for this to ship.
   */
  events: boolean;
  /** Bounded live inference stages, token counts and throughput on status events. */
  liveInference: boolean;
  /** Every completed Brain log line arrives immediately on the SSE stream. */
  logEvents: boolean;
  /** Whether writes are currently permitted (allowRemoteConfig). */
  writable: boolean;
  /** POST/GET /__host/jobs and POST /__host/jobs/cancel. */
  jobs: boolean;
  /** POST /__host/restart delegates a restart to the service owner. */
  restart: boolean;
}

/** A long-running operation owned by this brain host, not its caller. */
export interface HostJob {
  id: string;
  kind: "pull" | "runtime-install" | "runtime-remove" | "calibrate" | "sweep" | "bench";
  label: string;
  target: string | null;
  status: "running" | "succeeded" | "failed" | "canceled";
  /** Positive while the shared scheduler has not admitted this operation yet. */
  queuePosition?: number | null;
  percent: number | null;
  message: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface HostJobRunner {
  start: (
    kind: HostJob["kind"],
    target: string | null,
    args: string[],
    /** A bundle entry owns its companion-artifact queue, not the whole host. */
    pull?: { entryKey: string; components: string[] },
  ) => HostJob;
  list: () => HostJob[];
  cancel: (jobId: string) => Promise<HostJob[]>;
  query: (args: string[], area?: BrainLogArea) => Promise<unknown>;
}

export interface HostApiDeps {
  supervisor: Supervisor;
  /** The live catalog. Replaced wholesale by `rescan`. */
  getCatalog: () => Model[];
  /** Re-read the model directories, e.g. after a delete. Returns the new catalog. */
  rescan: () => Model[];
  getProfilesStore: () => ProfilesStore;
  saveProfiles: (store: ProfilesStore) => void;
  getProfileDefaults: () => ProfileDefaults | undefined;
  queryGpuInfo: () => Promise<GpuInfo | null>;
  getRanking: () => RankedModel[];
  loadModel: (model: Model) => Promise<void>;
  /** The single model queue shared by completions and resident operations. */
  scheduler?: Scheduler | null;
  /** Mirrors POST /__host/config's gate: may a network caller change things? */
  getAllowWrite: () => boolean;
  /** The managed models directory, for disk accounting. Null when unresolvable. */
  getModelsDir: () => string | null;
  sampleResources: () => Promise<SystemSample>;
  /**
   * The live status source behind `GET /__host/events`. Absent (or not yet
   * carrying a snapshot source) means this brain does not advertise events and
   * its daemon keeps polling status.
   */
  statusEvents?: BrainStatusPublisher | null;
  /** The append-only line stream behind `GET /__host/events`. */
  logEvents?: BrainLogPublisher | null;
  /** Long operations that must execute on this brain's machine. */
  jobs?: HostJobRunner;
  /** The append-only log owned by this Brain service run. */
  runLog?: BrainRunLog;
  /** Gracefully restart the serving process after its HTTP acknowledgement. */
  restart?: () => void;
  /** Durable service-session operation log. */
  log?: (area: BrainLogArea, message: string) => void;
}

/** One row of the model inventory: the scan, metadata, profile and score joined. */
export interface InventoryRow {
  id: string;
  displayName: string;
  /** Curated model-family identity for the Otto Brain client glyph. */
  family: string | null;
  publisher: string | null;
  quant: string | null;
  sizeBytes: number;
  mmprojBytes: number;
  origin: string | null;
  arch: string | null;
  contextLength: number | null;
  blockCount: number | null;
  headCountKv: number | null;
  /** Capability flags, matching the TUI's V / M / R badges. */
  hasProjector: boolean;
  reasoning: boolean;
  mtp: boolean;
  distilled: boolean;
  useCases: string[];
  tier: string | null;
  profile: Profile;
  calibration: ReturnType<typeof calibrationInfo>;
  budget: vram.Budget | null;
  maxContextThatFits: number | null;
  score: RankedModel | null;
  state: "loaded" | "loading" | "unloading" | "active" | "queued" | "not-loaded";
  warnings: ReturnType<typeof profileWarnings>;
  components: NonNullable<Model["components"]> | null;
}

/**
 * Apply the hosting-profile half of a profile patch, mutating both `profile`
 * (this model's selection) and `store` (the shared library and family default).
 *
 * Separate from `sanitizeProfilePatch` because these keys are not profile
 * fields: three of the five write to the store rather than the profile.
 * Exported for testing - the ordering and the cross-profile cleanup are the
 * parts worth pinning down, and they are unreachable through the HTTP surface
 * without standing up a service.
 *
 * Throws on any invalid input; the caller turns that into a 400.
 */
export function applyHostingProfilePatch(
  store: ProfilesStore,
  model: Model,
  profile: Profile,
  patch: Record<string, unknown>,
  onDelete: ((id: string) => void) | undefined = undefined,
): void {
  const family = hostingFamily(model.family);

  if ("hostingProfileId" in patch) {
    const selected = patch.hostingProfileId;
    if (selected !== null && typeof selected !== "string") {
      throw new Error("hostingProfileId must be a string or null");
    }
    if (selected && !store.hostingProfiles[selected]) {
      throw new Error("selected hosting profile does not exist");
    }
    profile.hostingProfileId = selected || null;
    profile.hostingProfileMode = selected ? "custom" : "off";
  }

  // After the id, so a client can send both and have the explicit mode win.
  if ("hostingProfileMode" in patch) {
    const mode = patch.hostingProfileMode;
    if (mode !== "inherit" && mode !== "off" && mode !== "custom") {
      throw new Error("hostingProfileMode must be inherit, off, or custom");
    }
    if (mode === "custom" && !profile.hostingProfileId) {
      throw new Error("select a custom profile before using custom mode");
    }
    profile.hostingProfileMode = mode;
  }

  if ("familyHostingProfileId" in patch) {
    const selected = patch.familyHostingProfileId;
    if (selected !== null && typeof selected !== "string") {
      throw new Error("familyHostingProfileId must be a string or null");
    }
    if (selected && !store.hostingProfiles[selected]) {
      throw new Error("selected family hosting profile does not exist");
    }
    if (selected && store.hostingProfiles[selected].family !== family) {
      throw new Error("selected family hosting profile must match the selected model");
    }
    // Null is a real instruction: it is the only way off a family default.
    store.familyHostingProfileIds[family] = selected || null;
  }

  if ("hostingProfile" in patch) {
    const candidate = HostingProfileSchema.safeParse(patch.hostingProfile);
    if (!candidate.success) throw new Error("hosting profile is invalid");
    const item = candidate.data;
    // Name the field that is wrong. One shared "name or text is too long" for an
    // empty name, a missing template and an oversized addendum told a remote or
    // CLI caller nothing about what to change.
    if (item.name.trim().length === 0) throw new Error("hosting profile needs a name");
    if (item.name.length > MAX_HOSTING_PROFILE_NAME) {
      throw new Error(
        `hosting profile name must be ${MAX_HOSTING_PROFILE_NAME} characters or fewer`,
      );
    }
    if (!item.template?.trim()) throw new Error("hosting profile needs a Jinja chat template");
    if (item.template.length > MAX_HOSTING_PROFILE_TEXT) {
      throw new Error("hosting profile chat template is too long");
    }
    if ((item.systemPromptAddendum?.length ?? 0) > MAX_HOSTING_PROFILE_TEXT) {
      throw new Error("hosting profile system prompt is too long");
    }
    if (item.family !== family) {
      throw new Error("hosting profile family must match the selected model");
    }
    const isNew = item.id.length === 0;
    const id = isNew ? `hosting_${randomUUID()}` : item.id;
    if (!isNew && BUILTIN_HOSTING_PROFILE_IDS.has(id)) {
      throw new Error("built-in hosting profiles cannot be edited");
    }
    if (!isNew && (id.length > MAX_HOSTING_PROFILE_ID || !HOSTING_PROFILE_ID.test(id))) {
      throw new Error(
        `hosting profile id must use only letters, numbers, underscores, or hyphens and be ${MAX_HOSTING_PROFILE_ID} characters or fewer`,
      );
    }
    if (!isNew && !store.hostingProfiles[id]) {
      throw new Error("hosting profile does not exist; create profiles without an id");
    }
    if (isNew && Object.keys(store.hostingProfiles).length >= MAX_HOSTING_PROFILES) {
      throw new Error(`hosting profile limit of ${MAX_HOSTING_PROFILES} reached`);
    }
    store.hostingProfiles[id] = { ...item, id, name: item.name.trim() };
    // Only a freshly created profile is auto-selected. Editing the text of an
    // existing one must not silently convert a model that was on System default
    // into a custom override of it.
    if (isNew) {
      profile.hostingProfileId = id;
      profile.hostingProfileMode = "custom";
    }
  }

  if (typeof patch.deleteHostingProfileId === "string") {
    const id = patch.deleteHostingProfileId;
    if (BUILTIN_HOSTING_PROFILE_IDS.has(id)) {
      throw new Error("built-in hosting profiles cannot be deleted");
    }
    delete store.hostingProfiles[id];
    onDelete?.(id);
    if (profile.hostingProfileId === id) {
      profile.hostingProfileId = null;
      profile.hostingProfileMode = "off";
    }
    // Clear the mode alongside the id on every other model. Leaving `custom`
    // behind with no id left those models unsavable: the mode guard above
    // rejects the next write each of them makes.
    for (const saved of Object.values(store.profiles)) {
      if (saved.hostingProfileId !== id) continue;
      saved.hostingProfileId = null;
      saved.hostingProfileMode = "off";
    }
    for (const [key, selected] of Object.entries(store.familyHostingProfileIds)) {
      if (selected === id) store.familyHostingProfileIds[key] = null;
    }
  }

  // One invariant, enforced after every branch: an id belongs only to `custom`.
  // It is what lets `forModel`'s legacy migration read a stored id as an
  // unambiguous "this profile predates hostingProfileMode".
  if (profile.hostingProfileMode !== "custom") profile.hostingProfileId = null;
}

/** The hosting profiles a model may choose from: its family's bucket, nothing else. */
function hostingProfilesFor(store: ProfilesStore, model: Model): HostingProfile[] {
  const family = hostingFamily(model.family);
  return Object.values(store.hostingProfiles).filter((candidate) => candidate.family === family);
}

function stateOf(
  supervisor: Supervisor,
  scheduler: Scheduler | null | undefined,
  model: Model,
): InventoryRow["state"] {
  const resident = supervisor.model?.id === model.id;
  if (resident) {
    if (supervisor.state === "starting") return "loading";
    if (supervisor.state === "stopping") return "unloading";
  }
  const stats = scheduler?.stats();
  if (stats?.active?.modelId === model.id) return "active";
  if ((stats?.waitingModelIds[model.id] ?? 0) > 0) return "queued";
  if (resident && supervisor.state === "ready") return "loaded";
  return "not-loaded";
}

/**
 * Join one model's scan row, GGUF metadata, saved profile, calibration, VRAM
 * budget and benchmark score into the single shape the Models tab renders.
 *
 * Exported for testing: the join is the part worth pinning down, since the
 * client would otherwise have to correlate three unrelated lists by display name.
 */
export function buildInventoryRow(params: {
  model: Model;
  store: ProfilesStore;
  defaults: ProfileDefaults | undefined;
  gpu: GpuInfo | null;
  ranking: RankedModel[];
  supervisor: Supervisor;
  scheduler?: Scheduler | null;
  runtimeBuild?: number | null;
}): InventoryRow {
  const {
    model,
    store,
    defaults,
    gpu,
    ranking,
    supervisor,
    scheduler = null,
    runtimeBuild: activeRuntimeBuild = null,
  } = params;
  const profile = forModel(store, model, defaults);
  const calibration = profile.calibrationRequired ? null : getCalibration(store, model, profile);

  const budgetOptions = gpu
    ? { model, profile, calibration, totalVramBytes: gpu.totalBytes }
    : null;

  const ranked =
    ranking.find((r) => r.id === model.id || r.displayName === model.displayName) ?? null;

  return {
    id: model.id,
    displayName: model.displayName,
    family: model.family ?? null,
    publisher: model.publisher ?? null,
    quant: model.quant,
    sizeBytes: model.sizeBytes,
    mmprojBytes: model.mmprojBytes,
    origin: model.origin ?? null,
    arch: model.metadata?.arch ?? null,
    contextLength: model.metadata?.contextLength ?? null,
    blockCount: model.metadata?.blockCount ?? null,
    headCountKv: model.metadata?.headCountKv ?? null,
    // A bundle declares vision capability even before its projector is
    // downloaded. The badge describes what the model supports, while the
    // profile's component row describes whether that artifact is ready.
    hasProjector:
      Boolean(model.mmprojPath) ||
      Boolean(model.components?.some((component) => component.role === "vision_projector")),
    reasoning: Boolean(model.metadata?.reasoning ?? model.thinking),
    mtp: Boolean(model.features?.mtp),
    distilled: Boolean(model.features?.distilled),
    useCases: model.useCases ?? [],
    tier: model.tier ?? null,
    profile,
    calibration: calibrationInfo(store, model, profile),
    budget: budgetOptions ? vram.budget(budgetOptions) : null,
    maxContextThatFits: budgetOptions ? vram.maxContextThatFits(budgetOptions) : null,
    score: ranked,
    state: stateOf(supervisor, scheduler, model),
    warnings: profileWarnings(profile, model, store),
    components:
      model.components?.map((component) => {
        if (
          component.minRuntimeBuild === undefined ||
          (activeRuntimeBuild !== null && activeRuntimeBuild >= component.minRuntimeBuild)
        ) {
          return component;
        }
        const active = activeRuntimeBuild === null ? "unknown" : `b${activeRuntimeBuild}`;
        return {
          ...component,
          available: false,
          unavailableReason:
            `Requires llama.cpp build b${component.minRuntimeBuild} or newer ` +
            `(active build: ${active})`,
        };
      }) ?? null,
  };
}

/**
 * Reject a request value that the CLI would read as a flag rather than as a
 * value.
 *
 * An option value has to sit before the `--` separator by construction - the
 * separator only ends *positional* parsing - so unlike `model` and `repo` these
 * cannot be moved out of harm's way, and the argv is unambiguous only if the
 * value itself is. The throw surfaces as the route's 400, next to the type
 * checks in each `makeArgs`.
 */
function optionValue(label: string, value: string): string {
  if (value.startsWith("-")) throw new Error(`${label} must not start with "-"`);
  return value;
}

/** Resolve a model by id or display name, the same way the completion path does. */
function resolveModel(catalog: Model[], needle: string | null): Model | null {
  if (!needle) return null;
  return catalog.find((m) => m.id === needle || m.displayName === needle) ?? null;
}

/**
 * Read a hypothetical profile from query parameters, so the client can show the
 * VRAM budget updating as a field is edited without persisting a value the user
 * may be in the middle of scrubbing past.
 */
function profileFromQuery(base: Profile, params: URLSearchParams, model: Model): Profile {
  const patch: Record<string, unknown> = {};
  // The samplers cost no VRAM and so change nothing in the budget this powers,
  // but they ride in the same draft the editor sends. Parse them anyway: an
  // unparsed key reaches sanitizeProfilePatch as the string "0.8" and throws,
  // which would fail the whole preview over a field it does not even price.
  const numeric = [
    "contextSize",
    "gpuLayers",
    "parallelSlots",
    "cachedChats",
    "reasoningBudget",
    "temperature",
    "topP",
    "topK",
    "minP",
    "presencePenalty",
    "repeatPenalty",
  ];
  for (const key of numeric) {
    const raw = params.get(key);
    if (raw !== null && raw !== "") patch[key] = Number(raw);
  }
  for (const key of ["cacheTypeK", "cacheTypeV"]) {
    const raw = params.get(key);
    if (raw) patch[key] = raw;
  }
  for (const key of ["flashAttention", "vision"]) {
    const raw = params.get(key);
    if (raw !== null && raw !== "") patch[key] = raw === "true" || raw === "1";
  }
  // Tri-state, and every spelling a client might use for it. Unknown text is
  // dropped rather than thrown on: this field prices nothing, so a value this
  // route cannot read must not take the whole budget preview down with it.
  const preserve = params.get("preserveReasoning");
  if (preserve === "true" || preserve === "on") patch.preserveReasoning = true;
  else if (preserve === "false" || preserve === "off") patch.preserveReasoning = false;
  else if (preserve === "default" || preserve === "null") patch.preserveReasoning = null;
  if (Object.keys(patch).length === 0) return base;
  return sanitizeProfilePatch(base, patch, model, runtimeBuild(null)).profile;
}

export interface HostApi {
  /** Returns true when it answered the request, false to fall through. */
  handle: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
  /**
   * The current capability set. Exposed separately from the route so
   * `/__host/status` can carry it inline: the daemon polls status constantly and
   * would otherwise need a second round trip, or a cache that goes stale the
   * moment `allowRemoteConfig` is toggled, since `writable` lives in here.
   */
  capabilities: () => HostCapabilities;
}

/**
 * Build the `/__host/*` management handler.
 */
export function createHostApi(deps: HostApiDeps): HostApi {
  const capabilities = (): HostCapabilities => ({
    profiles: true,
    budget: true,
    logs: true,
    delete: true,
    load: true,
    resources: true,
    inventory: true,
    rename: true,
    reset: true,
    // Read live rather than captured: the publisher is inert until the router
    // installs its snapshot source, and advertising a stream we cannot serve
    // would make a daemon stop polling and see nothing.
    events: Boolean(deps.statusEvents?.ready),
    liveInference: Boolean(deps.statusEvents?.ready),
    logEvents: Boolean(deps.statusEvents?.ready && deps.logEvents),
    writable: deps.getAllowWrite(),
    jobs: Boolean(deps.jobs),
    restart: Boolean(deps.restart),
  });

  /** Refuse a write unless the owner opted into remote configuration. */
  const guardWrite = (res: http.ServerResponse): boolean => {
    if (deps.getAllowWrite()) return true;
    sendError(
      res,
      403,
      "remote configuration is disabled on this brain; enable it with `otto brain share --allow-config`",
    );
    return false;
  };

  const inventory = async (): Promise<InventoryRow[]> => {
    const [gpu, store] = [await deps.queryGpuInfo(), deps.getProfilesStore()];
    const defaults = deps.getProfileDefaults();
    const ranking = deps.getRanking();
    return deps.getCatalog().map((model) =>
      buildInventoryRow({
        model,
        store,
        defaults,
        gpu,
        ranking,
        supervisor: deps.supervisor,
        scheduler: deps.scheduler,
        runtimeBuild: runtimeBuild(deps.supervisor.runtime),
      }),
    );
  };

  const handleModelsList = (res: http.ServerResponse): void => {
    void (async () => {
      try {
        const models = await inventory();
        const dir = deps.getModelsDir();
        const disk = dir ? await diskUsage(dir) : null;
        sendJson(res, {
          models,
          disk: disk ? { ...disk, modelBytes: totalModelBytes(deps.getCatalog()) } : null,
        });
      } catch (error) {
        sendError(res, 500, `could not build the model inventory: ${errorMessage(error)}`);
      }
    })();
  };

  const handleProfileGet = (res: http.ServerResponse, model: Model): void => {
    const store = deps.getProfilesStore();
    const profile = forModel(store, model, deps.getProfileDefaults());
    sendJson(res, {
      profile,
      fields: profileFieldDescriptors(model, profile),
      warnings: profileWarnings(profile, model, store),
      calibration: calibrationInfo(store, model, profile),
      requiresRestart: store.pendingReloadModelIds[model.id] === true,
      hostingProfiles: hostingProfilesFor(store, model),
      familyHostingProfileId: familyHostingProfileId(store, model.family),
    });
  };

  const handleProfileSet = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    model: Model,
  ): void => {
    readJsonBody(req, MAX_PATCH_BYTES, (result) => {
      if (!result.ok) {
        sendError(res, 400, result.error);
        return;
      }
      void (async () => {
        try {
          const store = deps.getProfilesStore();
          const current = forModel(store, model, deps.getProfileDefaults());
          const activeRuntimeBuild = runtimeBuild(deps.supervisor.runtime);
          const { profile, adjustments } = sanitizeProfilePatch(
            current,
            result.body,
            model,
            activeRuntimeBuild,
          );
          applyHostingProfilePatch(
            store,
            model,
            profile,
            result.body as Record<string, unknown>,
            (id) => removeHostingProfileMaterialization(deps.supervisor.paths, id),
          );
          put(store, model, profile);
          // A setting is only unapplied when it was changed on the currently
          // resident model. Edits to an unloaded model take effect naturally
          // when it is next loaded and do not earn a misleading reload badge.
          const requiresRestart = deps.supervisor.model?.id === model.id;
          if (requiresRestart) store.pendingReloadModelIds[model.id] = true;
          deps.saveProfiles(store);
          deps.log?.(
            "model",
            `updated profile for ${model.displayName}${requiresRestart ? "; reload required" : ""}`,
          );

          // Return the recomputed budget so an edit costs one round trip rather
          // than a write followed by a read the UI has to sequence.
          const gpu = await deps.queryGpuInfo();
          const calibration = profile.calibrationRequired
            ? null
            : getCalibration(store, model, profile);
          const options = gpu
            ? { model, profile, calibration, totalVramBytes: gpu.totalBytes }
            : null;
          sendJson(res, {
            profile,
            fields: profileFieldDescriptors(model, profile),
            adjustments,
            warnings: profileWarnings(profile, model, store),
            calibration: calibrationInfo(store, model, profile),
            budget: options ? vram.budget(options) : null,
            maxContextThatFits: options ? vram.maxContextThatFits(options) : null,
            /** True when the running model is the one just edited: a restart applies it. */
            requiresRestart,
            hostingProfiles: hostingProfilesFor(store, model),
            familyHostingProfileId: familyHostingProfileId(store, model.family),
          });
        } catch (error) {
          sendError(res, 400, errorMessage(error));
        }
      })();
    });
  };

  const handleRename = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    model: Model,
  ): void => {
    readJsonBody(req, MAX_DISPLAY_NAME + 64, (result) => {
      if (!result.ok) {
        sendError(res, 400, result.error);
        return;
      }
      const body = result.body as { displayName?: unknown };
      const displayName = body.displayName;
      if (typeof displayName !== "string" || displayName.trim().length === 0) {
        sendError(res, 400, "displayName must be a non-empty string");
        return;
      }
      if (displayName.length > MAX_DISPLAY_NAME) {
        sendError(res, 400, `displayName must be at most ${MAX_DISPLAY_NAME} characters`);
        return;
      }
      if (/[^\x20-\x7E]/.test(displayName)) {
        sendError(res, 400, "displayName must not contain control characters or non-ASCII");
        return;
      }
      // /v1/models keys its `id` on displayName (router.ts) and both the
      // completion path and defaultModel/switchTo resolve a model by
      // `displayName === name || id === name` - a collision here would make
      // one of the two models unreachable by name with no error anywhere.
      const conflict = deps
        .getCatalog()
        .find((m) => m.id !== model.id && (m.displayName === displayName || m.id === displayName));
      if (conflict) {
        sendError(res, 409, `another model is already named "${displayName}"`);
        return;
      }
      updateDisplayName(model.id, displayName);
      // The catalog is kept in memory between requests. Refresh it here so
      // the next inventory request, and all model lookups, see the persisted
      // name immediately instead of reverting to the scan-derived name until
      // the brain is restarted. Reset already follows this pattern below.
      const catalog = deps.rescan();
      const updated = resolveModel(catalog, model.id);
      deps.log?.("library", `renamed ${model.displayName} to ${displayName}`);
      sendJson(res, { displayName: updated ? updated.displayName : displayName });
    });
  };

  const handleReset = (req: http.IncomingMessage, res: http.ServerResponse, model: Model): void => {
    readJsonBody(req, 4096, (result) => {
      if (!result.ok) {
        sendError(res, 400, result.error);
        return;
      }
      deleteDisplayName(model.id);
      const catalog = deps.rescan();
      const updated = resolveModel(catalog, model.id);
      deps.log?.("library", `reset display name for ${model.displayName}`);
      sendJson(res, { displayName: updated ? updated.displayName : model.displayName });
    });
  };

  const handleBudget = (res: http.ServerResponse, model: Model, params: URLSearchParams): void => {
    void (async () => {
      try {
        const store = deps.getProfilesStore();
        const saved = forModel(store, model, deps.getProfileDefaults());
        const profile = profileFromQuery(saved, params, model);
        const gpu = await deps.queryGpuInfo();
        if (!gpu) {
          sendJson(res, {
            profile,
            budget: null,
            maxContextThatFits: null,
            gpu: null,
            reason: "no NVIDIA GPU detected",
          });
          return;
        }
        const options = {
          model,
          profile,
          calibration: profile.calibrationRequired ? null : getCalibration(store, model, profile),
          totalVramBytes: gpu.totalBytes,
        };
        sendJson(res, {
          profile,
          budget: vram.budget(options),
          maxContextThatFits: vram.maxContextThatFits(options),
          gpu: { name: gpu.name, totalBytes: gpu.totalBytes, usedBytes: gpu.usedBytes },
          warnings: profileWarnings(profile, model, store),
        });
      } catch (error) {
        sendError(res, 400, errorMessage(error));
      }
    })();
  };

  const handleLoad = (res: http.ServerResponse, model: Model): void => {
    void (async () => {
      const store = deps.getProfilesStore();
      const profile = forModel(store, model, deps.getProfileDefaults());

      // The TUI refuses this combination at the `s` key rather than letting
      // llama-server fail to allocate the cache and time out at "starting".
      const blocking = profileWarnings(profile, model, store).find((w) => w.blocksStart);
      if (blocking) {
        sendError(res, 409, blocking.message);
        return;
      }

      try {
        deps.log?.("model", `loading ${model.displayName}`);
        await deps.loadModel(model);
        deps.log?.("model", `loaded ${model.displayName}`);
        sendJson(res, {
          status: deps.supervisor.status(),
          // What actually got used: loadModel fits the profile to VRAM, so the
          // context here may be lower than the one saved.
          profile: deps.supervisor.profile,
        });
      } catch (error) {
        deps.log?.("model", `failed to load ${model.displayName}: ${errorMessage(error)}`);
        sendError(res, 409, `could not load ${model.displayName}: ${errorMessage(error)}`);
      }
    })();
  };

  const handleUnload = (res: http.ServerResponse): void => {
    void (async () => {
      try {
        deps.log?.("model", "unloading resident model");
        await deps.supervisor.stop();
        deps.log?.("model", "resident model unloaded");
        sendJson(res, { status: deps.supervisor.status() });
      } catch (error) {
        sendError(res, 500, `could not unload: ${errorMessage(error)}`);
      }
    })();
  };

  const handleDelete = (res: http.ServerResponse, model: Model): void => {
    if (deps.supervisor.model?.id === model.id && deps.supervisor.state !== "stopped") {
      sendError(res, 409, "stop the model before deleting it");
      return;
    }
    try {
      const plan = deleteModelFiles(model);
      const catalog = deps.rescan();
      deps.log?.("library", `deleted ${model.displayName}; freed ${plan.bytes} bytes`);
      sendJson(res, {
        deleted: plan.files,
        freedBytes: plan.bytes,
        includesProjector: plan.includesProjector,
        remaining: catalog.length,
      });
    } catch (error) {
      sendError(res, 500, `could not delete ${model.displayName}: ${errorMessage(error)}`);
    }
  };

  const handleComponentDelete = (
    res: http.ServerResponse,
    model: Model,
    componentId: string,
  ): void => {
    if (deps.supervisor.model?.id === model.id && deps.supervisor.state !== "stopped") {
      sendError(res, 409, "stop the model before removing a bundle component");
      return;
    }
    try {
      const plan = deleteComponentFile(model, componentId);
      deps.rescan();
      deps.log?.(
        "library",
        `deleted ${componentId} from ${model.displayName}; freed ${plan.bytes} bytes`,
      );
      sendJson(res, {
        deleted: plan.files,
        freedBytes: plan.bytes,
        componentIds: plan.componentIds,
      });
    } catch (error) {
      sendError(res, 409, errorMessage(error));
    }
  };

  const handleLogs = (res: http.ServerResponse, params: URLSearchParams): void => {
    const raw = Number(params.get("limit"));
    const limit =
      Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 1000) : DEFAULT_LOG_LINES;
    const session = deps.runLog?.tail(limit);
    const all = deps.supervisor.logLines;
    sendJson(res, {
      lines: session?.lines ?? all.slice(-limit),
      total: session?.total ?? all.length,
      state: deps.supervisor.state,
      command: deps.supervisor.command,
    });
  };

  /**
   * Stream complete status snapshots as SSE.
   *
   * Authentication is the listener's, not this route's: `withAuth` in serve.ts
   * gates every `/__host/*` path with the same token and TLS policy, so an
   * unauthenticated caller never reaches this function.
   *
   * The stream is unidirectional and outlives the request, which is exactly why
   * SSE rather than a socket the brain would have to dial back to a daemon: a
   * remote brain has no idea where its daemon is, and the daemon already knows
   * how to reach the brain over an authenticated HTTP(S) endpoint.
   */
  const handleEvents = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    publisher: BrainStatusPublisher,
  ): void => {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells nginx-shaped intermediaries not to buffer, which would defeat the
      // whole point by holding each snapshot until the response ended.
      "x-accel-buffering": "no",
    });
    res.flushHeaders?.();

    const write = (snapshot: BrainStatusSnapshot): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: status\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };
    const writeLog = (line: string): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: log\ndata: ${JSON.stringify({ line })}\n\n`);
    };
    let unsubscribe = (): void => {};
    let unsubscribeLogs = (): void => {};
    const keepalive = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write(": keepalive\n\n");
    }, SSE_KEEPALIVE_MS);
    keepalive.unref?.();

    const teardown = (): void => {
      clearInterval(keepalive);
      unsubscribe();
      unsubscribeLogs();
    };
    // The publisher ends the response on host shutdown: an open SSE response is
    // an open connection, and `server.close()` waits for those.
    unsubscribe = publisher.subscribe(write, () => {
      clearInterval(keepalive);
      if (!res.writableEnded && !res.destroyed) res.end();
    });
    unsubscribeLogs = deps.logEvents?.subscribe(writeLog) ?? (() => {});
    // Both ends matter: `close` on the request covers a client that walked away,
    // and `close` on the response covers the service shutting the socket down.
    req.on("close", teardown);
    res.on("close", teardown);
  };

  function handleHostApi(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const raw = req.url || "";
    if (!raw.startsWith("/__host/")) return false;

    const url = new URL(raw, "http://brain.local");
    const route = url.pathname;
    const params = url.searchParams;
    const method = (req.method || "GET").toUpperCase();

    if (route === "/__host/capabilities" && method === "GET") {
      sendJson(res, capabilities());
      return true;
    }

    if (route === "/__host/events" && method === "GET") {
      const publisher = deps.statusEvents;
      if (!publisher?.ready) {
        sendError(res, 404, "this brain does not serve a status event stream");
        return true;
      }
      handleEvents(req, res, publisher);
      return true;
    }

    // A remote caller can restart a managed brain without gaining start/stop
    // control over the host daemon. Acknowledge first so it does not race the
    // connection it is about to close.
    if (route === "/__host/restart" && method === "POST") {
      if (!deps.restart) {
        sendError(res, 404, "this brain cannot restart itself");
        return true;
      }
      if (!guardWrite(res)) return true;
      deps.log?.("server", "restart requested through the management API");
      sendJson(res, { accepted: true });
      queueMicrotask(() => deps.restart?.());
      return true;
    }

    if (route === "/__host/logs" && method === "GET") {
      handleLogs(res, params);
      return true;
    }

    // Benchmark jobs are deliberately host-owned. A remote daemon only proxies
    // these calls, so selecting a remote brain can never wake the local GPU.
    if (route === "/__host/jobs" && method === "GET") {
      if (!deps.jobs) {
        sendError(res, 404, "this brain does not serve remote jobs");
      } else {
        sendJson(res, { jobs: deps.jobs.list() });
      }
      return true;
    }
    if (route === "/__host/jobs/bench" && method === "POST") {
      if (!deps.jobs) {
        sendError(res, 404, "this brain does not serve remote jobs");
        return true;
      }
      readJsonBody(req, 4096, (result) => {
        if (!result.ok) {
          sendError(res, 400, result.error);
          return;
        }
        const model = (result.body as { model?: unknown }).model;
        if (model !== undefined && model !== null && typeof model !== "string") {
          sendError(res, 400, "model must be a string or null");
          return;
        }
        try {
          sendJson(res, {
            job:
              deps.jobs?.start("bench", model ?? null, [
                "bench",
                ...(model ? ["--model", optionValue("model", model)] : []),
              ]) ?? null,
          });
        } catch (error) {
          sendError(res, 409, errorMessage(error));
        }
      });
      return true;
    }
    const jobStarts: Record<
      string,
      {
        kind: Exclude<HostJob["kind"], "bench">;
        makeArgs: (body: Record<string, unknown>) => {
          target: string | null;
          args: string[];
          pull?: { entryKey: string; components: string[] };
        };
      }
    > = {
      "/__host/jobs/pull": {
        kind: "pull",
        makeArgs: (body) => {
          const model = body.model;
          if (typeof model !== "string" || !model) throw new Error("model is required");
          const components = body.components;
          const quant = body.quant;
          if (
            components !== undefined &&
            (!Array.isArray(components) || !components.every((id) => typeof id === "string"))
          ) {
            throw new Error("components must be component ids");
          }
          if (quant !== undefined && typeof quant !== "string")
            throw new Error("quant must be a string");
          return {
            target: model,
            args: [
              "pull",
              ...(typeof quant === "string" ? ["--quant", optionValue("quant", quant)] : []),
              ...(components ?? []).flatMap((id) => ["--component", optionValue("component", id)]),
              "--json",
              "--",
              model,
            ],
            pull: { entryKey: model, components: components ?? [] },
          };
        },
      },
      "/__host/jobs/add": {
        kind: "pull",
        makeArgs: (body) => {
          const repo = body.repo;
          const quant = body.quant;
          const components = body.components;
          if (typeof repo !== "string" || !repo || typeof quant !== "string" || !quant)
            throw new Error("repo and quant are required");
          if (
            components !== undefined &&
            (!Array.isArray(components) || !components.every((id) => typeof id === "string"))
          )
            throw new Error("components must be component ids");
          return {
            target: `${repo}#${quant}`,
            args: [
              "add",
              "--quant",
              optionValue("quant", quant),
              ...(components === undefined ? [] : ["--primary-only"]),
              ...(components ?? []).flatMap((id) => ["--component", optionValue("component", id)]),
              "--json",
              "--",
              repo,
            ],
            pull: { entryKey: `${repo}#${quant}`, components: components ?? [] },
          };
        },
      },
      "/__host/jobs/runtime-install": {
        kind: "runtime-install",
        makeArgs: (body) => {
          const build = body.build;
          if (build !== undefined && build !== null && typeof build !== "string")
            throw new Error("build must be a string or null");
          return {
            target: typeof build === "string" ? build : null,
            args: [
              "runtime",
              "install",
              "--json",
              ...(typeof build === "string" ? ["--build", optionValue("build", build)] : []),
            ],
          };
        },
      },
      // Removal is host-owned for the same reason installation is: the runtimes
      // directory belongs to this machine. A daemon in brain.mode=remote that ran
      // this locally would delete a same-named runtime out of its own OTTO_HOME.
      "/__host/jobs/runtime-remove": {
        kind: "runtime-remove",
        makeArgs: (body) => {
          const name = body.name;
          if (typeof name !== "string" || !name) throw new Error("name is required");
          // Pass the name as an operand, not as a flag candidate. The CLI still
          // owns the real safety check (the name regex plus the parent-dir
          // assertion in removeManagedRuntime).
          return { target: name, args: ["runtime", "remove", "--json", "--", name] };
        },
      },
      "/__host/jobs/calibrate": {
        kind: "calibrate",
        makeArgs: (body) => {
          const model = body.model;
          if (typeof model !== "string" || !model) throw new Error("model is required");
          return {
            target: model,
            args: ["calibrate", "--model", optionValue("model", model), "--json"],
          };
        },
      },
      "/__host/jobs/sweep": {
        kind: "sweep",
        makeArgs: (body) => {
          const model = body.model;
          if (typeof model !== "string" || !model) throw new Error("model is required");
          return {
            target: model,
            args: ["sweep", "--model", optionValue("model", model), "--json"],
          };
        },
      },
    };
    const start = jobStarts[route];
    if (start && method === "POST") {
      if (!deps.jobs) {
        sendError(res, 404, "this brain does not serve remote jobs");
        return true;
      }
      if (!guardWrite(res)) return true;
      readJsonBody(req, 4096, (result) => {
        if (!result.ok) {
          sendError(res, 400, result.error);
          return;
        }
        try {
          const spec = start.makeArgs(result.body as Record<string, unknown>);
          sendJson(res, {
            job: deps.jobs?.start(start.kind, spec.target, spec.args, spec.pull) ?? null,
          });
        } catch (error) {
          sendError(res, 400, errorMessage(error));
        }
      });
      return true;
    }
    if (route === "/__host/catalog" && method === "GET") {
      deps.log?.("library", "refreshing the model catalog");
      void deps.jobs
        ?.query(["catalog", "--json"], "library")
        .then((models) => sendJson(res, { models }));
      return true;
    }
    if (route === "/__host/runtimes" && method === "GET") {
      void deps.jobs
        ?.query(["runtime", "list", "--json"], "library")
        .then((runtimes) => sendJson(res, { runtimes }));
      return true;
    }
    if (route === "/__host/hf/search" && method === "GET") {
      const query = params.get("query") ?? "";
      const limit = Math.max(1, Math.min(100, Number(params.get("limit")) || 25));
      deps.log?.("library", `searching Hugging Face for ${JSON.stringify(query)} (limit ${limit})`);
      void deps.jobs
        ?.query(["search", "--json", "--limit", String(limit), "--", query], "library")
        .then((results) => sendJson(res, { results }));
      return true;
    }
    if (route === "/__host/hf/quants" && method === "GET") {
      const repo = params.get("repo") ?? "";
      deps.log?.("library", `listing Hugging Face quants for ${repo}`);
      void deps.jobs
        ?.query(["add", "--list-quants", "--json", "--", repo], "library")
        .then((quants) => sendJson(res, { quants }));
      return true;
    }
    if (route === "/__host/jobs/cancel" && method === "POST") {
      if (!deps.jobs) {
        sendError(res, 404, "this brain does not serve remote jobs");
        return true;
      }
      readJsonBody(req, 4096, (result) => {
        if (!result.ok) {
          sendError(res, 400, result.error);
          return;
        }
        const jobId = (result.body as { jobId?: unknown }).jobId;
        if (typeof jobId !== "string" || !jobId) {
          sendError(res, 400, "jobId is required");
          return;
        }
        void deps.jobs
          ?.cancel(jobId)
          .then((jobs) => sendJson(res, { jobs }))
          .catch((error) => sendError(res, 500, errorMessage(error)));
      });
      return true;
    }

    if (route === "/__host/resources" && method === "GET") {
      void (async () => {
        try {
          sendJson(res, await deps.sampleResources());
        } catch (error) {
          sendError(res, 500, `could not sample resources: ${errorMessage(error)}`);
        }
      })();
      return true;
    }

    if (route === "/__host/models" && method === "GET") {
      handleModelsList(res);
      return true;
    }

    // A local daemon may run downloads in its own tracked job process while
    // this service owns the in-memory inventory. Reconcile that disk mutation
    // without restarting the host or unloading its resident model.
    if (route === "/__host/models/rescan" && method === "POST") {
      const models = deps.rescan();
      deps.log?.("library", `rescanned model library: ${models.length} models`);
      sendJson(res, { models: models.length });
      return true;
    }

    if (route === "/__host/model/unload" && method === "POST") {
      if (!guardWrite(res)) return true;
      handleUnload(res);
      return true;
    }

    // Everything below is model-scoped and needs ?id=.
    const modelRoutes = new Set([
      "/__host/model",
      "/__host/model/profile",
      "/__host/model/budget",
      "/__host/model/load",
      "/__host/model/fields",
      "/__host/model/rename",
      "/__host/model/rename/reset",
      "/__host/model/component",
    ]);
    if (!modelRoutes.has(route)) return false;

    const needle = params.get("id");
    const model = resolveModel(deps.getCatalog(), needle);
    if (!model) {
      sendError(res, 404, needle ? `model "${needle}" was not found` : "an ?id= is required");
      return true;
    }

    if (route === "/__host/model/fields" && method === "GET") {
      sendJson(res, { fields: profileFieldDescriptors(model) });
      return true;
    }
    if (route === "/__host/model/profile" && method === "GET") {
      handleProfileGet(res, model);
      return true;
    }
    if (route === "/__host/model/budget" && method === "GET") {
      handleBudget(res, model, params);
      return true;
    }
    if (route === "/__host/model/profile" && method === "POST") {
      if (!guardWrite(res)) return true;
      handleProfileSet(req, res, model);
      return true;
    }
    if (route === "/__host/model/load" && method === "POST") {
      if (!guardWrite(res)) return true;
      handleLoad(res, model);
      return true;
    }
    if (route === "/__host/model/rename" && method === "POST") {
      if (!guardWrite(res)) return true;
      handleRename(req, res, model);
      return true;
    }
    if (route === "/__host/model/rename/reset" && method === "POST") {
      if (!guardWrite(res)) return true;
      handleReset(req, res, model);
      return true;
    }
    if (route === "/__host/model" && method === "DELETE") {
      if (!guardWrite(res)) return true;
      handleDelete(res, model);
      return true;
    }
    if (route === "/__host/model/component" && method === "DELETE") {
      if (!guardWrite(res)) return true;
      const componentId = params.get("component");
      if (!componentId) {
        sendError(res, 400, "a component query parameter is required");
        return true;
      }
      handleComponentDelete(res, model, componentId);
      return true;
    }
    if (route === "/__host/model" && method === "GET") {
      // A single inventory row, for a detail pane that does not want the whole list.
      void (async () => {
        try {
          const gpu = await deps.queryGpuInfo();
          sendJson(
            res,
            buildInventoryRow({
              model,
              store: deps.getProfilesStore(),
              defaults: deps.getProfileDefaults(),
              gpu,
              ranking: deps.getRanking(),
              supervisor: deps.supervisor,
              runtimeBuild: runtimeBuild(deps.supervisor.runtime),
            }),
          );
        } catch (error) {
          sendError(res, 500, errorMessage(error));
        }
      })();
      return true;
    }

    sendError(res, 405, `${method} is not allowed on ${route}`);
    return true;
  }

  return { handle: handleHostApi, capabilities };
}

/** The delete plan without performing it, for a confirmation dialog. */
export function describeDelete(model: Model): ReturnType<typeof planDelete> {
  return planDelete(model);
}
