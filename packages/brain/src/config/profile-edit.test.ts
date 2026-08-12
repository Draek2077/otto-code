import { describe, expect, it } from "vitest";

import {
  calibrationInfo,
  formatReasoningBudget,
  nativeContextLimit,
  profileFieldDescriptors,
  profileWarnings,
  sanitizeProfilePatch,
} from "./profile-edit.js";
import { defaultProfile } from "./profiles.js";
import { ProfilesStoreSchema, type Profile, type ProfilesStore } from "./schema.js";
import type { Model } from "../types.js";

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "vendor/model-Q5_K_M.gguf",
    displayName: "Test Model",
    modelPath: "/models/vendor/model-Q5_K_M.gguf",
    mmprojPath: null,
    mmprojBytes: 0,
    quant: "Q5_K_M",
    sizeBytes: 8 * 1024 ** 3,
    features: { mtp: false, imatrix: false, distilled: false },
    metadata: {
      arch: "qwen3",
      contextLength: 32768,
      blockCount: 48,
      headCountKv: 8,
      keyLength: 128,
      valueLength: 128,
    },
    ...overrides,
  };
}

function makeProfile(model: Model, overrides: Partial<Profile> = {}): Profile {
  return { ...defaultProfile(model), ...overrides };
}

function emptyStore(): ProfilesStore {
  return ProfilesStoreSchema.parse({});
}

describe("nativeContextLimit", () => {
  it("uses the model's native window", () => {
    expect(nativeContextLimit(makeModel())).toBe(32768);
  });

  it("falls back to a bound when the header carries no context length", () => {
    expect(nativeContextLimit(makeModel({ metadata: { arch: "x" } }))).toBe(1_000_000);
  });
});

describe("profileFieldDescriptors", () => {
  it("offers the context multiplier and eight hosting fields", () => {
    const keys = profileFieldDescriptors(makeModel()).map((f) => f.key);
    expect(keys).toEqual([
      "contextMultiplier",
      "contextSize",
      "cacheTypeK",
      "cacheTypeV",
      "vision",
      "flashAttention",
      "reasoningBudget",
      "gpuLayers",
      "parallelSlots",
    ]);
  });

  it("marks vision unavailable without a projector, and available with one", () => {
    const without = profileFieldDescriptors(makeModel()).find((f) => f.key === "vision");
    expect(without?.available).toBe(false);
    expect(without?.unavailableReason).toBe("no projector");

    const withProjector = profileFieldDescriptors(
      makeModel({ mmprojPath: "/models/vendor/mmproj.gguf", mmprojBytes: 1024 }),
    ).find((f) => f.key === "vision");
    expect(withProjector?.available).toBe(true);
  });

  it("uses the bundle component toggle instead of the legacy vision field", () => {
    const fields = profileFieldDescriptors(
      makeModel({
        components: [
          {
            id: "vision-projector",
            label: "Image understanding",
            description: "Reads images.",
            role: "vision_projector",
            path: "/models/vendor/mmproj.gguf",
            bytes: 1024,
            required: false,
            defaultDownload: true,
            defaultLoad: false,
            available: true,
          },
        ],
      }),
    );
    expect(fields.some((field) => field.key === "vision")).toBe(false);
    expect(fields.map((field) => field.key)).toEqual([
      "contextMultiplier",
      "contextSize",
      "cacheTypeK",
      "cacheTypeV",
      "flashAttention",
      "reasoningBudget",
      "gpuLayers",
      "parallelSlots",
    ]);
  });

  it("caps the context field at the model's native window", () => {
    const field = profileFieldDescriptors(makeModel()).find((f) => f.key === "contextSize");
    expect(field?.max).toBe(32768);
  });
});

describe("sanitizeProfilePatch", () => {
  it("applies a valid patch", () => {
    const model = makeModel();
    const { profile, adjustments } = sanitizeProfilePatch(
      makeProfile(model),
      { contextSize: 16384, cacheTypeK: "q4_0", parallelSlots: 4 },
      model,
    );
    expect(profile.contextSize).toBe(16384);
    expect(profile.cacheTypeK).toBe("q4_0");
    expect(profile.parallelSlots).toBe(4);
    expect(adjustments).toEqual([]);
  });

  it("clamps a context above the model's native window and reports it", () => {
    const model = makeModel();
    const { profile, adjustments } = sanitizeProfilePatch(
      makeProfile(model),
      { contextSize: 999_999 },
      model,
    );
    expect(profile.contextSize).toBe(32768);
    expect(adjustments).toEqual(["contextSize clamped to 32768"]);
  });

  it("clamps parallel slots to the supported range", () => {
    const model = makeModel();
    expect(
      sanitizeProfilePatch(makeProfile(model), { parallelSlots: 99 }, model).profile.parallelSlots,
    ).toBe(16);
    expect(
      sanitizeProfilePatch(makeProfile(model), { parallelSlots: 0 }, model).profile.parallelSlots,
    ).toBe(1);
  });

  it("refuses vision on a model with no projector rather than saving a lie", () => {
    const model = makeModel();
    const { profile, adjustments } = sanitizeProfilePatch(
      makeProfile(model),
      { vision: true },
      model,
    );
    expect(profile.vision).toBe(false);
    expect(adjustments).toEqual(["vision ignored: this model has no projector"]);
  });

  it("accepts vision when a projector is paired", () => {
    const model = makeModel({ mmprojPath: "/models/vendor/mmproj.gguf", mmprojBytes: 1024 });
    const { profile } = sanitizeProfilePatch(makeProfile(model), { vision: true }, model);
    expect(profile.vision).toBe(true);
  });

  it("rejects an unknown KV cache type instead of writing one that cannot start", () => {
    const model = makeModel();
    expect(() => sanitizeProfilePatch(makeProfile(model), { cacheTypeK: "q3_k" }, model)).toThrow(
      /unknown KV cache type/,
    );
  });

  it("rejects a wrongly typed field", () => {
    const model = makeModel();
    expect(() =>
      sanitizeProfilePatch(makeProfile(model), { flashAttention: "yes" }, model),
    ).toThrow(/must be a boolean/);
    expect(() => sanitizeProfilePatch(makeProfile(model), { contextSize: "big" }, model)).toThrow(
      /must be a number/,
    );
  });

  it("floors the reasoning budget at -1, the unrestricted sentinel", () => {
    const model = makeModel();
    const { profile } = sanitizeProfilePatch(makeProfile(model), { reasoningBudget: -50 }, model);
    expect(profile.reasoningBudget).toBe(-1);
  });

  it("ignores keys outside the editable eight", () => {
    const model = makeModel();
    const { profile } = sanitizeProfilePatch(
      makeProfile(model),
      { modelPath: "/etc/passwd", extraArgs: ["--rm-rf"], batchSize: 4096 },
      model,
    );
    expect(profile.modelPath).toBe(model.modelPath);
    expect(profile.extraArgs).toEqual([]);
    expect(profile.batchSize).toBeNull();
  });

  it("rejects a non-object patch", () => {
    const model = makeModel();
    expect(() => sanitizeProfilePatch(makeProfile(model), [1, 2], model)).toThrow(
      /must be an object/,
    );
  });
});

describe("formatReasoningBudget", () => {
  it("names the -1 sentinel rather than printing it", () => {
    expect(formatReasoningBudget(-1)).toBe("unrestricted");
  });

  it("leaves real token counts alone, including the thinking-off zero", () => {
    expect(formatReasoningBudget(0)).toBe("0");
    expect(formatReasoningBudget(1536)).toBe("1536");
  });
});

describe("profileWarnings", () => {
  it("blocks a quantised V cache without flash attention", () => {
    const model = makeModel();
    const profile = makeProfile(model, { flashAttention: false, cacheTypeV: "q8_0" });
    const blocking = profileWarnings(profile, model).filter((w) => w.blocksStart);
    expect(blocking).toHaveLength(1);
    expect(blocking[0].field).toBe("flashAttention");
  });

  it("allows an f16 V cache without flash attention", () => {
    const model = makeModel();
    const profile = makeProfile(model, { flashAttention: false, cacheTypeV: "f16" });
    expect(profileWarnings(profile, model).filter((w) => w.blocksStart)).toHaveLength(0);
  });

  it("warns about an unrestricted reasoning budget without blocking the start", () => {
    const model = makeModel();
    const profile = makeProfile(model, { reasoningBudget: -1 });
    const warning = profileWarnings(profile, model).find((w) => w.field === "reasoningBudget");
    expect(warning?.severity).toBe("warn");
    expect(warning?.blocksStart).toBe(false);
  });

  it("says nothing about a sane profile beyond the defaults", () => {
    const model = makeModel();
    expect(profileWarnings(makeProfile(model), model)).toEqual([]);
  });
});

describe("calibrationInfo", () => {
  it("reports theoretical when nothing was ever measured", () => {
    const model = makeModel();
    const info = calibrationInfo(emptyStore(), model, makeProfile(model));
    expect(info.state).toBe("theoretical");
    expect(info.kvBytesPerToken).toBeNull();
  });

  it("reports measured for an exact cache-type match", () => {
    const model = makeModel();
    const profile = makeProfile(model);
    const store = emptyStore();
    store.calibrations[model.id] = {
      [`${profile.cacheTypeK}:${profile.cacheTypeV}`]: {
        kvBytesPerToken: 1234,
        baseOverheadBytes: 600,
        measuredAt: "2026-08-01T00:00:00.000Z",
      },
    };
    const info = calibrationInfo(store, model, profile);
    expect(info.state).toBe("measured");
    expect(info.kvBytesPerToken).toBe(1234);
  });

  it("reports stale when the measurement is for other cache types", () => {
    const model = makeModel();
    const profile = makeProfile(model, { cacheTypeK: "f16", cacheTypeV: "f16" });
    const store = emptyStore();
    // Measured for q8_0:q8_0, but the profile now asks for f16:f16. The geometry
    // fallback is keyed on cache types too, so it cannot rescue this either.
    store.calibrations[model.id] = {
      "q8_0:q8_0": { kvBytesPerToken: 1234, baseOverheadBytes: 600 },
    };
    expect(calibrationInfo(store, model, profile).state).toBe("stale");
  });

  it("never presents an inherited measurement as measured on this file", () => {
    const model = makeModel();
    const profile = makeProfile(model);
    const store = emptyStore();
    store.geometryCalibrations[
      ["qwen3", 8, 128, 128, profile.cacheTypeK, profile.cacheTypeV].join(":")
    ] = {
      kvBytesPerTokenPerLayer: 100,
      baseOverheadBytes: 600,
      measuredOn: "A Relative",
    };
    const info = calibrationInfo(store, model, profile);
    expect(info.state).toBe("inherited");
    expect(info.kvBytesPerToken).toBe(100 * 48);
    expect(info.measuredOn).toBe("A Relative");
  });
});
