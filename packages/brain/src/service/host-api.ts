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

import {
  calibrationInfo,
  profileFieldDescriptors,
  profileWarnings,
  sanitizeProfilePatch,
} from "../config/profile-edit.js";
import { forModel, getCalibration, put } from "../config/profiles.js";
import type { Profile, ProfileDefaults, ProfilesStore } from "../config/schema.js";
import { deleteModelFiles, diskUsage, planDelete, totalModelBytes } from "../models/manage.js";
import { deleteDisplayName, updateDisplayName } from "../models/rename-map.js";
import type { RankedModel } from "../ops/results.js";
import type { GpuInfo, Model } from "../types.js";
import * as vram from "../vram.js";
import type { SystemSample } from "../sysmon.js";
import { errorMessage, readJsonBody, sendError, sendJson } from "./http-util.js";
import type { BrainStatusPublisher, BrainStatusSnapshot } from "./status-events.js";
import type { Supervisor } from "./supervisor.js";

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_DISPLAY_NAME = 200;
const DEFAULT_LOG_LINES = 200;

/**
 * The management API's own version, additive to the capability flags.
 *
 * Capabilities answer "can this brain do X"; this answers "which generation of
 * the API is this" for the rare change that no single flag describes. A daemon
 * reads both and never requires an exact package-version match.
 */
export const HOST_API_VERSION = 1;

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
  /** Whether writes are currently permitted (allowRemoteConfig). */
  writable: boolean;
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
}

/** One row of the model inventory: the scan, metadata, profile and score joined. */
export interface InventoryRow {
  id: string;
  displayName: string;
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
  state: "loaded" | "loading" | "not-loaded";
  warnings: ReturnType<typeof profileWarnings>;
}

function stateOf(supervisor: Supervisor, model: Model): InventoryRow["state"] {
  if (!supervisor.model || supervisor.model.id !== model.id) return "not-loaded";
  if (supervisor.state === "ready") return "loaded";
  if (supervisor.state === "starting") return "loading";
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
}): InventoryRow {
  const { model, store, defaults, gpu, ranking, supervisor } = params;
  const profile = forModel(store, model, defaults);
  const calibration = getCalibration(store, model, profile);

  const budgetOptions = gpu
    ? { model, profile, calibration, totalVramBytes: gpu.totalBytes }
    : null;

  const ranked =
    ranking.find((r) => r.id === model.id || r.displayName === model.displayName) ?? null;

  return {
    id: model.id,
    displayName: model.displayName,
    publisher: model.publisher ?? null,
    quant: model.quant,
    sizeBytes: model.sizeBytes,
    mmprojBytes: model.mmprojBytes,
    origin: model.origin ?? null,
    arch: model.metadata?.arch ?? null,
    contextLength: model.metadata?.contextLength ?? null,
    blockCount: model.metadata?.blockCount ?? null,
    headCountKv: model.metadata?.headCountKv ?? null,
    hasProjector: Boolean(model.mmprojPath),
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
    state: stateOf(supervisor, model),
    warnings: profileWarnings(profile, model, store),
  };
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
  const numeric = ["contextSize", "gpuLayers", "parallelSlots", "reasoningBudget"];
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
  if (Object.keys(patch).length === 0) return base;
  return sanitizeProfilePatch(base, patch, model).profile;
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
    writable: deps.getAllowWrite(),
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
    return deps
      .getCatalog()
      .map((model) =>
        buildInventoryRow({ model, store, defaults, gpu, ranking, supervisor: deps.supervisor }),
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
      fields: profileFieldDescriptors(model),
      warnings: profileWarnings(profile, model, store),
      calibration: calibrationInfo(store, model, profile),
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
          const { profile, adjustments } = sanitizeProfilePatch(current, result.body, model);
          deps.saveProfiles(put(store, model, profile));

          // Return the recomputed budget so an edit costs one round trip rather
          // than a write followed by a read the UI has to sequence.
          const gpu = await deps.queryGpuInfo();
          const calibration = getCalibration(store, model, profile);
          const options = gpu
            ? { model, profile, calibration, totalVramBytes: gpu.totalBytes }
            : null;
          sendJson(res, {
            profile,
            adjustments,
            warnings: profileWarnings(profile, model, store),
            calibration: calibrationInfo(store, model, profile),
            budget: options ? vram.budget(options) : null,
            maxContextThatFits: options ? vram.maxContextThatFits(options) : null,
            /** True when the running model is the one just edited: a restart applies it. */
            requiresRestart: deps.supervisor.model?.id === model.id,
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
      sendJson(res, { displayName });
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
          calibration: getCalibration(store, model, profile),
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
        await deps.loadModel(model);
        sendJson(res, {
          status: deps.supervisor.status(),
          // What actually got used: loadModel fits the profile to VRAM, so the
          // context here may be lower than the one saved.
          profile: deps.supervisor.profile,
        });
      } catch (error) {
        sendError(res, 409, `could not load ${model.displayName}: ${errorMessage(error)}`);
      }
    })();
  };

  const handleUnload = (res: http.ServerResponse): void => {
    void (async () => {
      try {
        await deps.supervisor.stop();
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

  const handleLogs = (res: http.ServerResponse, params: URLSearchParams): void => {
    const raw = Number(params.get("limit"));
    const limit =
      Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), 1000) : DEFAULT_LOG_LINES;
    const all = deps.supervisor.logLines;
    sendJson(res, {
      lines: all.slice(-limit),
      total: all.length,
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
    let unsubscribe = (): void => {};
    const keepalive = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write(": keepalive\n\n");
    }, SSE_KEEPALIVE_MS);
    keepalive.unref?.();

    const teardown = (): void => {
      clearInterval(keepalive);
      unsubscribe();
    };
    // The publisher ends the response on host shutdown: an open SSE response is
    // an open connection, and `server.close()` waits for those.
    unsubscribe = publisher.subscribe(write, () => {
      clearInterval(keepalive);
      if (!res.writableEnded && !res.destroyed) res.end();
    });
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

    if (route === "/__host/logs" && method === "GET") {
      handleLogs(res, params);
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
