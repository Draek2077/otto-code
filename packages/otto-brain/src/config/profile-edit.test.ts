import { describe, expect, it, vi } from "vitest";

import os from "node:os";

import {
  calibrationInfo,
  ENGINE_DEFAULT_CACHE_RAM_BYTES,
  formatReasoningBudget,
  nativeContextLimit,
  profileFieldDescriptors,
  profileWarnings,
  sanitizeProfilePatch,
} from "./profile-edit.js";
import {
  defaultProfile,
  getCalibrationForBudget,
  hasStaleCalibration,
  putCalibration,
} from "./profiles.js";
import { ProfilesStoreSchema, type Profile, type ProfilesStore } from "./schema.js";
import { GIB } from "../vram.js";
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
  it("offers the hosting fields, then the samplers", () => {
    const keys = profileFieldDescriptors(makeModel()).map((f) => f.key);
    expect(keys).toEqual([
      "contextMultiplier",
      "contextSize",
      "cacheTypeK",
      "cacheTypeV",
      "parallelSlots",
      "cachedChats",
      "flashAttention",
      "vision",
      "reasoningBudget",
      "preserveReasoning",
      "gpuLayers",
      "temperature",
      "topP",
      "topK",
      "minP",
      "presencePenalty",
      "repeatPenalty",
    ]);
  });

  it("describes every field, so a client never has to write its own tooltip", () => {
    for (const field of profileFieldDescriptors(makeModel())) {
      expect(field.description, `${field.key} has no description`).toBeTruthy();
    }
  });

  it("gives every sampler a bounded range the editor can step through", () => {
    const samplers = ["temperature", "topP", "topK", "minP", "presencePenalty", "repeatPenalty"];
    for (const key of samplers) {
      const field = profileFieldDescriptors(makeModel()).find((f) => f.key === key);
      expect(field, key).toBeDefined();
      expect(typeof field?.min, key).toBe("number");
      expect(typeof field?.max, key).toBe("number");
      expect(field?.step, key).toBeGreaterThan(0);
      expect(field?.max, key).toBeGreaterThan(field?.min ?? 0);
    }
  });

  // The old gate was `reasoningPreservation.templateArgument`, a regex hit on the
  // chat template that almost no template produces - so the control was hidden on
  // models whose template llama.cpp itself reports as supporting preservation.
  it("offers preserve reasoning whenever the template has a thinking channel", () => {
    const thinking = profileFieldDescriptors(
      makeModel({ metadata: { arch: "qwen3", contextLength: 32768, reasoning: true } }),
    ).find((f) => f.key === "preserveReasoning");
    expect(thinking?.available).toBe(true);
    expect(thinking?.options).toEqual(["default", "on", "off"]);

    const noThinking = profileFieldDescriptors(makeModel()).find(
      (f) => f.key === "preserveReasoning",
    );
    expect(noThinking?.available).toBe(false);
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
      "parallelSlots",
      "cachedChats",
      "flashAttention",
      "reasoningBudget",
      "preserveReasoning",
      "gpuLayers",
      "temperature",
      "topP",
      "topK",
      "minP",
      "presencePenalty",
      "repeatPenalty",
    ]);
  });

  it("caps the context field at the model's native window", () => {
    const field = profileFieldDescriptors(makeModel()).find((f) => f.key === "contextSize");
    expect(field?.max).toBe(32768);
  });

  it("keeps a template-declared preservation default as the profile's starting value", () => {
    const model = makeModel({
      reasoningPreservation: { templateArgument: "preserve_thinking", default: true },
    });
    expect(
      profileFieldDescriptors(model).find((field) => field.key === "preserveReasoning"),
    ).toEqual(expect.objectContaining({ kind: "cycle", available: true }));
    expect(defaultProfile(model).preserveReasoning).toBe(true);
  });

  // Null, not false: a profile nobody has touched must launch exactly as it did
  // before the setting existed, which means emitting no preservation flag.
  it("defaults preservation to the template's own behavior", () => {
    expect(defaultProfile(makeModel()).preserveReasoning).toBeNull();
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

  it("stores preserve reasoning as a tri-state, from either spelling", () => {
    const model = makeModel({
      reasoningPreservation: { templateArgument: "preserve_thinking" },
    });
    const base = makeProfile(model);

    expect(
      sanitizeProfilePatch(base, { preserveReasoning: true }, model).profile.preserveReasoning,
    ).toBe(true);
    expect(
      sanitizeProfilePatch(base, { preserveReasoning: "off" }, model).profile.preserveReasoning,
    ).toBe(false);
    // The third state is not "false": it means leave the template's own default.
    expect(
      sanitizeProfilePatch(base, { preserveReasoning: "default" }, model).profile.preserveReasoning,
    ).toBeNull();
    expect(
      sanitizeProfilePatch(base, { preserveReasoning: null }, model).profile.preserveReasoning,
    ).toBeNull();
  });

  it("rejects a preserve reasoning value that is neither state nor spelling", () => {
    const model = makeModel();
    expect(() =>
      sanitizeProfilePatch(makeProfile(model), { preserveReasoning: "maybe" }, model),
    ).toThrow(/preserveReasoning/u);
  });

  it("clamps samplers to their range and reports it", () => {
    const model = makeModel();
    const { profile, adjustments } = sanitizeProfilePatch(
      makeProfile(model),
      { temperature: 9, topP: 0.4, minP: -1, repeatPenalty: 5 },
      model,
    );
    expect(profile.temperature).toBe(2);
    expect(profile.topP).toBe(0.4);
    expect(profile.minP).toBe(0);
    expect(profile.repeatPenalty).toBe(2);
    expect(adjustments).toEqual([
      "temperature clamped to 2",
      "minP clamped to 0",
      "repeatPenalty clamped to 2",
    ]);
  });

  // A stepper that adds 0.05 six times sends 0.30000000000000004. Without the
  // rounding that lands in the profile and then on llama-server's command line.
  it("rounds a sampler to the precision the editor advertises", () => {
    const model = makeModel();
    const { profile, adjustments } = sanitizeProfilePatch(
      makeProfile(model),
      { temperature: 0.30000000000000004, topK: 40.6 },
      model,
    );
    expect(profile.temperature).toBe(0.3);
    expect(profile.topK).toBe(41);
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

  it("re-clamps an inherited extended context when the multiplier drops", () => {
    const model = makeModel();
    const current = makeProfile(model, {
      contextMultiplier: 4,
      contextSize: 131072,
      calibrationRequired: false,
    });

    const { profile, adjustments } = sanitizeProfilePatch(current, { contextMultiplier: 1 }, model);

    expect(profile.contextSize).toBe(32768);
    expect(adjustments).toEqual(["contextSize clamped to 32768"]);
    // The multiplier is an evaluation input: the RoPE shape changed, so the
    // measurement must be re-taken even though the context clamp is cosmetic.
    expect(profile.calibrationRequired).toBe(true);
  });

  it("keeps the calibration when only placement or slot settings change", () => {
    const model = makeModel();
    const current = makeProfile(model, { calibrationRequired: false, gpuLayers: 999 });
    const result = sanitizeProfilePatch(current, { gpuLayers: 24, parallelSlots: 4 }, model);

    // Neither the KV cache system nor the evaluation changed: the differential
    // measurement is identical at any layer split and slot count.
    expect(result.profile.gpuLayers).toBe(24);
    expect(result.profile.parallelSlots).toBe(4);
    expect(result.profile.calibrationRequired).toBe(false);
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

describe("putCalibration", () => {
  it("persists a cleared calibration requirement for the calibrated model", () => {
    const model = makeModel();
    const profile = makeProfile(model, { calibrationRequired: true });
    const store = emptyStore();

    putCalibration(store, model, profile, {
      kvBytesPerToken: 1234,
      baseOverheadBytes: 600,
      measuredAt: "2026-08-01T00:00:00.000Z",
    });

    expect(store.profiles[model.id]?.calibrationRequired).toBe(false);
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

  it("prices cached chats in RAM once the model has been measured", () => {
    const model = makeModel();
    const profile = makeProfile(model, {
      cachedChats: 4,
      parallelSlots: 2,
      contextSize: 32768,
    });
    const store = putCalibration(emptyStore(), model, profile, {
      kvBytesPerToken: 40000,
      baseOverheadBytes: 0,
    });

    const warning = profileWarnings(profile, model, store).find((w) => w.field === "cachedChats");
    // 4 chats x 16384 tokens per slot x 40000 B/token = ~2.4 GiB total, 0.6 each.
    expect(warning?.message).toContain("0.6G each becomes 2.4G");
    expect(warning?.blocksStart).toBe(false);
  });

  it("keeps pricing cached chats from the last measurement while calibration is stale", () => {
    const model = makeModel();
    const profile = makeProfile(model, {
      cacheTypeK: "f16",
      cacheTypeV: "f16",
      cachedChats: 4,
      parallelSlots: 2,
      contextSize: 32768,
      calibrationRequired: true,
    });
    const store = emptyStore();
    store.calibrations[model.id] = {
      "q8_0:q8_0": {
        kvBytesPerToken: 40000,
        baseOverheadBytes: 0,
      },
    };

    const warning = profileWarnings(profile, model, store).find((w) => w.field === "cachedChats");
    expect(warning?.message).toContain("0.6G each becomes 2.4G");
  });

  it("refuses to price cached chats for an unmeasured model", () => {
    const model = makeModel({ metadata: { arch: "qwen3", contextLength: 32768 } });
    const profile = makeProfile(model, { cachedChats: 4 });

    const warning = profileWarnings(profile, model, emptyStore()).find(
      (w) => w.field === "cachedChats",
    );
    expect(warning?.severity).toBe("warn");
    expect(warning?.message).toContain("Calibrate");
    expect(warning?.blocksStart).toBe(false);
  });

  it("prices the Default of 0 at llama.cpp's own cache-ram limit, not the model's KV cost", () => {
    const model = makeModel();
    const totalmem = vi.spyOn(os, "totalmem").mockReturnValue(64 * GIB);
    try {
      const warning = profileWarnings(makeProfile(model), model).find(
        (w) => w.field === "cachedChats",
      );
      // 0 emits no flag, so the engine parks up to its own 8192 MiB default.
      // Model-independent: no calibration exists, and none is required.
      expect(warning).toEqual({
        field: "cachedChats",
        severity: "info",
        message: `llama.cpp's own limit applies: about ${
          ENGINE_DEFAULT_CACHE_RAM_BYTES / GIB
        }.0G of 64.0G.`,
        blocksStart: false,
      });
    } finally {
      totalmem.mockRestore();
    }
  });

  it("colours the estimate by how much of the installed RAM it would take", () => {
    const totalmem = vi.spyOn(os, "totalmem").mockReturnValue(64 * GIB);
    try {
      const measured = (kvBytesPerToken: number, cachedChats: number) => {
        const model = makeModel();
        const profile = makeProfile(model, { cachedChats, contextSize: 32768 });
        const store = putCalibration(emptyStore(), model, profile, {
          kvBytesPerToken,
          baseOverheadBytes: 0,
        });
        return profileWarnings(profile, model, store).find((w) => w.field === "cachedChats");
      };

      // 1 chat x 32768 tokens x 40000 B/token = ~1.2 GiB: well under half of 64 GiB.
      const info = measured(40_000, 1);
      expect(info?.severity).toBe("info");
      // 1 chat x 32768 tokens x 1048576 B/token = 32 GiB: half of 64 GiB, at the edge.
      const warn = measured(1_048_576, 1);
      expect(warn?.severity).toBe("warn");
      // 2 chats x 32768 tokens x 1048576 B/token = 64 GiB: all of the installed RAM.
      const error = measured(1_048_576, 2);
      expect(error?.severity).toBe("error");
    } finally {
      totalmem.mockRestore();
    }
  });

  it("still shows the estimate for a sane profile, at the engine's default size", () => {
    const model = makeModel();
    const warnings = profileWarnings(makeProfile(model), model);
    expect(warnings.filter((w) => w.field === "cachedChats")).toHaveLength(1);
    const estimate = warnings.find((w) => w.field === "cachedChats")!;
    expect(estimate.blocksStart).toBe(false);
    expect(estimate.severity).toBe("info");
    // 8 GiB is below half of any machine this code runs on, so the Default is
    // muted rather than loud.
    expect(estimate.message).toMatch(/^llama\.cpp's own limit applies: about 8\.0G of \d+\.\dG\.$/);
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
    const profile = makeProfile(model, { calibrationRequired: false });
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
    const profile = makeProfile(model, {
      cacheTypeK: "f16",
      cacheTypeV: "f16",
      calibrationRequired: false,
    });
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
    const profile = makeProfile(model, { calibrationRequired: false });
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

  it("keeps the last measurement visible while a profile edit needs recalibration", () => {
    const model = makeModel();
    const profile = makeProfile(model, { calibrationRequired: true });
    const store = emptyStore();
    store.calibrations[model.id] = {
      [`${profile.cacheTypeK}:${profile.cacheTypeV}`]: {
        kvBytesPerToken: 1234,
        baseOverheadBytes: 600,
      },
    };

    const info = calibrationInfo(store, model, profile);
    expect(info.state).toBe("stale");
    expect(info.kvBytesPerToken).toBe(1234);
  });

  it("does not call an exact calibration stale just because history has older keys", () => {
    const model = makeModel();
    const profile = makeProfile(model, { calibrationRequired: false });
    const store = emptyStore();
    store.calibrations[model.id] = {
      "q8_0:q8_0": { kvBytesPerToken: 1234, baseOverheadBytes: 600 },
      "f16:f16": { kvBytesPerToken: 2345, baseOverheadBytes: 700 },
    };

    expect(hasStaleCalibration(store, model, profile)).toBe(false);
    expect(getCalibrationForBudget(store, model, profile)?.kvBytesPerToken).toBe(1234);
  });
});

describe("sanitizeProfilePatch", () => {
  it("marks VRAM-affecting edits as needing calibration", () => {
    const model = makeModel();
    const result = sanitizeProfilePatch(
      makeProfile(model, { calibrationRequired: false }),
      { cacheTypeK: "q4_0" },
      model,
    );

    expect(result.profile.calibrationRequired).toBe(true);
  });

  // The editor autosaves the whole draft, so every calibration input is present
  // in every patch. Keying off presence threw a real measurement away whenever
  // any unrelated field was saved.
  it("keeps the calibration when a resent value has not changed", () => {
    const model = makeModel();
    const current = makeProfile(model, { calibrationRequired: false });
    const result = sanitizeProfilePatch(
      current,
      {
        contextSize: current.contextSize,
        cacheTypeK: current.cacheTypeK,
        cacheTypeV: current.cacheTypeV,
        flashAttention: current.flashAttention,
        gpuLayers: current.gpuLayers,
        parallelSlots: current.parallelSlots,
        contextMultiplier: current.contextMultiplier,
        // Not a VRAM input: changing it must not cost the measurement either.
        reasoningBudget: 512,
      },
      model,
    );

    expect(result.profile.reasoningBudget).toBe(512);
    expect(result.profile.calibrationRequired).toBe(false);
  });

  // "Fit to VRAM" sizes the context from the measured figure and then writes it.
  // Context size is not a calibration input, so the measured budget remains
  // the same after that write.
  it("keeps the calibration when only the context size changes", () => {
    const model = makeModel();
    const current = makeProfile(model, { calibrationRequired: false });
    const result = sanitizeProfilePatch(current, { contextSize: current.contextSize / 2 }, model);

    expect(result.profile.contextSize).toBe(current.contextSize / 2);
    expect(result.profile.calibrationRequired).toBe(false);
  });

  it("ignores the order of the enabled component list", () => {
    const model = makeModel({
      components: [
        { id: "a", role: "vision_projector", available: true },
        { id: "b", role: "speech", available: true },
      ] as Model["components"],
    });
    const current = makeProfile(model, {
      calibrationRequired: false,
      enabledComponents: ["a", "b"],
      // Already true, since the enabled projector is what derives it. Leaving it
      // false would make this a real vision change rather than a reorder.
      vision: true,
    });

    const result = sanitizeProfilePatch(current, { enabledComponents: ["b", "a"] }, model);

    expect(result.profile.calibrationRequired).toBe(false);
  });

  it("refuses a component that needs a newer llama.cpp build", () => {
    const model = makeModel({
      components: [
        {
          id: "draft",
          role: "speculative_drafter",
          available: true,
          minRuntimeBuild: 10265,
        },
      ] as Model["components"],
    });

    expect(() =>
      sanitizeProfilePatch(makeProfile(model), { enabledComponents: ["draft"] }, model, 10264),
    ).toThrow(/require llama\.cpp build b10265 or newer/i);
  });
});
