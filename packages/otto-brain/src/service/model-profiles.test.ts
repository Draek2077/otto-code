import { expect, it } from "vitest";
import { BrainConfigSchema, ProfilesStoreSchema, type ProfilesStore } from "../config/schema.js";
import { put } from "../config/profiles.js";
import type { Model } from "../types.js";
import { ModelProfiles } from "./model-profiles.js";

const model = {
  id: "fixture/model",
  modelPath: "/fixture/model.gguf",
  displayName: "Fixture",
  mmprojPath: null,
} as Model;
const measurement = {
  kvBytesPerToken: 1,
  baseOverheadBytes: 2,
  measuredAt: "2026-10-23T00:00:00Z",
  cacheTypeK: "q8_0",
  cacheTypeV: "q8_0",
  vision: false,
};
function fixture() {
  let store: ProfilesStore = ProfilesStoreSchema.parse({ preserved: { future: true } });
  const profiles = new ModelProfiles(BrainConfigSchema.parse({}), {
    read: () => structuredClone(store),
    write: (next) => {
      store = structuredClone(next);
    },
    runtimeBuild: () => null,
  });
  return {
    profiles,
    store: () => store,
    edit: (patch: Record<string, unknown>) => {
      put(store, model, { ...profiles.read(model).profile, ...patch });
    },
  };
}

it("rejects stale saves while preserving peer edits and unknown store fields", () => {
  const { profiles, store } = fixture();
  const original = profiles.read(model);
  const saved = profiles.save(model, { temperature: 0.4 }, original.revision);
  expect(saved.profile.temperature).toBe(0.4);
  expect(saved.revision).not.toBe(original.revision);
  expect(() => profiles.save(model, { topK: 12 }, original.revision)).toThrow("changed");
  expect(profiles.read(model).profile.temperature).toBe(0.4);
  expect(store().preserved).toEqual({ future: true });
});

it("retains a measured calibration without overwriting edits made during it", () => {
  const { profiles, edit, store } = fixture();
  const before = profiles.read(model).profile;
  edit({ temperature: 0.3, futureSetting: "retained" });
  profiles.recordCalibration(model, before, measurement);
  const current = profiles.read(model).profile;
  expect(current.temperature).toBe(0.3);
  expect(current.futureSetting).toBe("retained");
  expect(current.calibrationRequired).toBe(true);
  expect(store().calibrations[model.id]).toEqual({ "q8_0:q8_0": measurement });
});

it("clears recalibration only for the unchanged measured profile", () => {
  const { profiles } = fixture();
  profiles.recordCalibration(model, profiles.read(model).profile, measurement);
  expect(profiles.read(model).profile.calibrationRequired).toBe(false);
});

it("applies a sweep recommendation only if its source profile is still current", () => {
  const { profiles, edit } = fixture();
  const before = profiles.read(model).revision;
  edit({ reasoningBudget: 700 });
  expect(profiles.recordSweep(model, before, 512)).toBe(false);
  expect(profiles.read(model).profile.reasoningBudget).toBe(700);
  expect(profiles.recordSweep(model, profiles.read(model).revision, 512)).toBe(true);
  expect(profiles.read(model).profile.reasoningBudget).toBe(512);
  expect(profiles.recordSweep(model, profiles.read(model).revision, null)).toBe(false);
});

it("rejects a stale model edit after its shared template library changes", () => {
  const { profiles } = fixture();
  const initial = profiles.read(model);
  const created = profiles.save(
    model,
    { hostingProfile: { id: "", family: "generic", name: "Fixture", template: "{{ messages }}" } },
    initial.revision,
  );
  const inherited = profiles.save(model, { hostingProfileMode: "inherit" }, created.revision);
  const edited = profiles.save(
    model,
    { hostingProfile: { ...inherited.hostingProfiles[0], template: "changed" } },
    inherited.revision,
  );
  expect(edited.profile).toEqual(inherited.profile);
  expect(edited.revision).not.toEqual(inherited.revision);
  expect(() => profiles.save(model, { temperature: 0.1 }, inherited.revision)).toThrow("changed");
  expect(profiles.recordSweep(model, inherited.revision, 512)).toBe(false);
  expect(profiles.read(model).profile.reasoningBudget).toBe(inherited.profile.reasoningBudget);
});
