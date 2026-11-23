import { describe, expect, it } from "vitest";
import { snapshot } from "../../test-tui.js";
import { BrainTuiSnapshotSchema, TuiBenchmarkSchema } from "./contracts.js";
import { BrainTuiLiveSchema, tuiResidents } from "./live.js";

describe("terminal presentation boundary", () => {
  it("keeps actual opaque identities while removing owning-host paths and unknown private data", () => {
    const data = snapshot();
    const raw = JSON.parse(JSON.stringify(data));
    raw.secret = "private-fixture";
    raw.models[0].model.modelPath = "private-fixture";
    raw.models[0].model.metadata.private = "private-fixture";
    raw.models[0].profile.savedKey = "private-fixture";
    const parsed = BrainTuiSnapshotSchema.parse(raw);
    expect(parsed.models[0].model.repo).toBe("owner/model");
    expect(JSON.stringify(parsed)).not.toContain("private-fixture");
    expect(parsed.models[0].revision).toBe("revision-1");
    expect(raw.models[0].profile.savedKey).toBe("private-fixture");
  });
  it("refuses missing profile fields rather than inventing launch defaults", () => {
    const data = snapshot();
    const raw = JSON.parse(JSON.stringify(data));
    delete raw.models[0].profile.contextSize;
    expect(BrainTuiSnapshotSchema.safeParse(raw).success).toBe(false);
  });
  it("retains a historical benchmark without manufacturing newer forensic metadata", () => {
    expect(
      TuiBenchmarkSchema.parse({
        ranAt: "historical",
        configKey: "original",
        overall: 0.75,
        grade: "strong",
        seconds: 10,
        model: { displayName: "Old model" },
        tasks: [{ id: "task", category: "coding", score: 0.75, detail: null }],
      }),
    ).toMatchObject({ model: { displayName: "Old model" }, tasks: [{ detail: null }] });
  });
  it("uses actual idle and active slot IDs, with resident-qualified thinking stages", () => {
    const raw = {
      instanceId: "owner",
      version: "fixture",
      state: "ready",
      libraryRevision: 1,
      jobRevision: 0,
      capabilities: { writable: true, tui: true },
      telemetry: snapshot().telemetry,
      residents: ["first", "second"].map((id) => ({
        residentId: id,
        modelId: `model:${id}`,
        model: id,
        state: "ready",
        slots: { idleSlots: [7], threads: [{ slot: 0, phase: "decode" }] },
        inference: { slotStages: { "0": id === "first" ? "thinking" : "generating" } },
      })),
    };
    const rows = tuiResidents(BrainTuiLiveSchema.parse(raw));
    expect(rows).toMatchObject([
      {
        residentId: "first",
        slots: [
          { slot: 7, phase: "idle" },
          { slot: 0, phase: "thinking" },
        ],
      },
      {
        residentId: "second",
        slots: [
          { slot: 7, phase: "idle" },
          { slot: 0, phase: "generating" },
        ],
      },
    ]);
  });
});
