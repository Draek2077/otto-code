/** One revisioned profile writer shared by every host client and operation. */
import { createHash } from "node:crypto";
import type { BrainConfig, Calibration, Profile, ProfilesStore } from "../config/schema.js";
import type { Model } from "../types.js";
import { forModel, put, putCalibration, getCalibrationForBudget } from "../config/profiles.js";
import {
  calibrationInfo,
  profileFieldDescriptors,
  profileWarnings,
  sanitizeProfilePatch,
} from "../config/profile-edit.js";
import { RequestError } from "./http-body.js";
import { applyHostingProfilePatch, hostingProfilesFor } from "../config/hosting-profile-edit.js";
import { familyHostingProfileId } from "../config/hosting-profiles.js";

export interface ModelProfilePorts {
  read(): ProfilesStore;
  write(store: ProfilesStore): void;
  runtimeBuild(): number | null;
}

export function profileRevision(profile: Profile): string {
  return createHash("sha256").update(JSON.stringify(profile)).digest("hex");
}

function editRevision(store: ProfilesStore, model: Model, profile: Profile): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        profile,
        hostingProfiles: hostingProfilesFor(store, model),
        familyHostingProfileId: familyHostingProfileId(store, model.family),
      }),
    )
    .digest("hex");
}

export class ModelProfiles {
  constructor(
    private readonly config: BrainConfig,
    private readonly ports: ModelProfilePorts,
  ) {}

  measurement(model: Model, profile: Profile) {
    return getCalibrationForBudget(this.ports.read(), model, profile);
  }

  revision(model: Model, store = this.ports.read()): string {
    return editRevision(store, model, forModel(store, model, this.config.defaults));
  }

  read(model: Model) {
    const store = this.ports.read();
    const profile = forModel(store, model, this.config.defaults);
    return {
      modelId: model.id,
      profile,
      revision: editRevision(store, model, profile),
      hostingProfiles: hostingProfilesFor(store, model),
      familyHostingProfileId: familyHostingProfileId(store, model.family),
      fields: profileFieldDescriptors(model, profile),
      warnings: profileWarnings(profile, model, store),
      calibration: calibrationInfo(store, model, profile),
    };
  }

  save(model: Model, patch: unknown, expectedRevision: string) {
    // No await between reading, comparing and atomic persistence: host requests
    // cannot interleave their read/modify/write. External editors are not peers
    // of this in-process writer and still require explicit file reconciliation.
    const store = this.ports.read();
    const current = forModel(store, model, this.config.defaults);
    if (editRevision(store, model, current) !== expectedRevision)
      throw new RequestError(409, "Brain profile changed; reload before saving");
    const result = this.applyPatch(store, model, current, patch);
    put(store, model, result.profile);
    this.ports.write(store);
    return { ...this.read(model), adjustments: result.adjustments };
  }

  private applyPatch(store: ProfilesStore, model: Model, current: Profile, patch: unknown) {
    try {
      const result = sanitizeProfilePatch(current, patch, model, this.ports.runtimeBuild());
      applyHostingProfilePatch(store, model, result.profile, patch as Record<string, unknown>);
      return result;
    } catch (error) {
      throw new RequestError(400, "Brain profile patch is invalid", { cause: error });
    }
  }

  recordCalibration(model: Model, measuredProfile: Profile, measurement: Calibration): void {
    const store = this.ports.read();
    const current = forModel(store, model, this.config.defaults);
    putCalibration(store, model, measuredProfile, measurement);
    // Preserve edits made while this long-running measurement held its lease.
    // Its measurement is retained under the actual measured allocation key.
    if (profileRevision(current) !== profileRevision(measuredProfile)) put(store, model, current);
    this.ports.write(store);
  }

  recordSweep(model: Model, expectedRevision: string, recommended: number | null): boolean {
    if (recommended === null) return false;
    const store = this.ports.read();
    const current = forModel(store, model, this.config.defaults);
    if (editRevision(store, model, current) !== expectedRevision) return false;
    put(store, model, { ...current, reasoningBudget: recommended });
    this.ports.write(store);
    return true;
  }
}
