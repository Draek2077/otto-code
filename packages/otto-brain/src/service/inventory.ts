/** Canonical host-side join. Display names never stand in for model identities. */
import type { Model, GpuInfo } from "../types.js";
import type { ProfileDefaults, ProfilesStore } from "../config/schema.js";
import { forModel, getCalibrationForBudget } from "../config/profiles.js";
import { calibrationInfo, profileWarnings } from "../config/profile-edit.js";
import { repoOfModel } from "../models/hf.js";
import type { RankedModel } from "../ops/results.js";
import { budget, maxContextThatFits, reserveBytesForGpu } from "../vram.js";

export type InventoryState =
  | "loaded"
  | "loading"
  | "unloading"
  | "active"
  | "queued"
  | "not-loaded";
export interface InventoryInput {
  model: Model;
  store: ProfilesStore;
  defaults: ProfileDefaults;
  gpu: GpuInfo | null;
  ranking: RankedModel[];
  state: InventoryState;
  runtimeBuild: number | null;
}

export function buildInventoryRow(input: InventoryInput) {
  const { model, store, defaults, gpu, ranking } = input;
  const profile = forModel(store, model, defaults);
  const calibration = getCalibrationForBudget(store, model, profile);
  const options = gpu
    ? {
        model,
        profile,
        calibration,
        totalVramBytes: gpu.totalBytes,
        reserveBytes: reserveBytesForGpu(gpu),
      }
    : null;
  const score =
    ranking.find((ranked) => ranked.id === model.id) ??
    ranking.find((ranked) => ranked.id === null && ranked.displayName === model.displayName) ??
    null;
  return {
    ...modelIdentity(model),
    ...modelCapabilities(model),
    profile,
    calibration: calibrationInfo(store, model, profile),
    budget: options ? budget(options) : null,
    maxContextThatFits: options ? maxContextThatFits(options) : null,
    score,
    state: input.state,
    warnings: profileWarnings(profile, model, store),
    components: inventoryComponents(model, input.runtimeBuild),
  };
}
export type InventoryRow = ReturnType<typeof buildInventoryRow>;

function modelIdentity(model: Model) {
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
    repo: repoOfModel(model),
    catalogOwned: Boolean(model.catalogId),
    catalogId: model.catalogId ?? null,
  };
}

function modelCapabilities(model: Model) {
  return {
    hasProjector:
      Boolean(model.mmprojPath) ||
      Boolean(model.components?.some((component) => component.role === "vision_projector")),
    reasoning: Boolean(model.metadata?.reasoning ?? model.thinking),
    mtp: Boolean(model.features?.mtp),
    distilled: Boolean(model.features?.distilled),
    useCases: model.useCases ?? [],
    tier: model.tier ?? null,
  };
}

function inventoryComponents(model: Model, runtimeBuild: number | null) {
  return (
    model.components?.map((component) => {
      if (
        component.minRuntimeBuild === undefined ||
        (runtimeBuild !== null && runtimeBuild >= component.minRuntimeBuild)
      )
        return component;
      const active = runtimeBuild === null ? "unknown" : `b${runtimeBuild}`;
      return {
        ...component,
        available: false,
        unavailableReason: `Requires llama.cpp build b${component.minRuntimeBuild} or newer (active build: ${active})`,
      };
    }) ?? null
  );
}
