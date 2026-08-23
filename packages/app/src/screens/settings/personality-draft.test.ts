import { describe, expect, it } from "vitest";
import type { AgentProfile } from "@otto-code/protocol/messages";
import { draftToPersonality, personalityToDraft } from "./personality-draft";

// The stored template is Paseo's AgentProfile, a superset of what this editor
// models. Everything here guards the same failure: a user opens an imported
// template, changes one field, presses Save, and silently loses the rest.
describe("personality draft round-trip", () => {
  const stored: AgentProfile = {
    id: "personality_builtin_sage",
    name: "Sage",
    provider: "claude",
    model: "claude-opus-4-8",
    effortLevel: "high",
    personalityPrompt: "Think first.",
    roles: ["advisor"],
    spinner: { glowA: "#111", glowB: "#222" },
    featureValues: { fast_mode: true },
    // A field only a newer daemon knows about; the schema passes it through.
    somethingNewerDaemonsWrite: { keep: "me" },
  } as AgentProfile;

  it("preserves fields the editor does not model", () => {
    const draft = personalityToDraft(stored);
    const saved = draftToPersonality({ ...draft, name: "Sage II" }, stored.id, stored);

    expect(saved.name).toBe("Sage II");
    expect((saved as Record<string, unknown>)["somethingNewerDaemonsWrite"]).toEqual({
      keep: "me",
    });
  });

  it("clears an editor field that the user emptied", () => {
    const draft = personalityToDraft(stored);
    const saved = draftToPersonality(
      { ...draft, personalityPrompt: "   ", effort: "" },
      stored.id,
      stored,
    );

    // Absent, not an empty string: emptying the form has to reach the wire as
    // "unset", which a merge over `previous` would not do on its own.
    expect(saved).not.toHaveProperty("personalityPrompt");
    expect(saved).not.toHaveProperty("effortLevel");
    expect(saved).not.toHaveProperty("thinkingOptionId");
  });

  // One control, two wire fields. Everything below guards that only one of the
  // pair is ever set, so the daemon resolver is never handed a contradiction.
  it("stores a canonical rung as the portable effortLevel", () => {
    const draft = { ...personalityToDraft(stored), effort: "high" };
    const saved = draftToPersonality(draft, stored.id, stored);

    expect(saved.effortLevel).toBe("high");
    expect(saved).not.toHaveProperty("thinkingOptionId");
  });

  it("pins an off-ladder provider option that the canonical scale cannot name", () => {
    // Claude advertises "ultracode" alongside the effort-named options. It
    // parses as no canonical rung, so storing it as `effortLevel` would resolve
    // to nothing; it has to be pinned exactly.
    const draft = { ...personalityToDraft(stored), effort: "ultracode" };
    const saved = draftToPersonality(draft, stored.id, stored);

    expect(saved.thinkingOptionId).toBe("ultracode");
    expect(saved).not.toHaveProperty("effortLevel");
  });

  it("reads a pinned option id back into the one effort control", () => {
    const pinned = { ...stored, effortLevel: undefined, thinkingOptionId: "ultracode" };
    expect(personalityToDraft(pinned as AgentProfile).effort).toBe("ultracode");
  });

  it("collapses a template carrying both effort fields down to one", () => {
    // Contradictory input: the daemon resolver already prefers the pinned id,
    // so saving normalizes to it rather than leaving a stale rung behind.
    const both = { ...stored, effortLevel: "high", thinkingOptionId: "ultracode" };
    const saved = draftToPersonality(
      personalityToDraft(both as AgentProfile),
      stored.id,
      both as AgentProfile,
    );

    expect(saved.thinkingOptionId).toBe("ultracode");
    expect(saved).not.toHaveProperty("effortLevel");
  });

  it("round-trips a template unchanged when nothing is edited", () => {
    const saved = draftToPersonality(personalityToDraft(stored), stored.id, stored);
    expect(saved).toEqual(stored);
  });

  it("creates a new template without a previous entry", () => {
    const draft = personalityToDraft(stored);
    const saved = draftToPersonality(draft, "personality_new", undefined);

    expect(saved.id).toBe("personality_new");
    expect((saved as Record<string, unknown>)["somethingNewerDaemonsWrite"]).toBeUndefined();
  });

  it("keeps the default-on switches absent and writes them only when off", () => {
    const draft = personalityToDraft(stored);
    // Absent means on for both, so the default state stays off the wire and an
    // older daemon reading this roster sees exactly what it saw before. It also
    // means re-saving an untouched template does not grow it.
    const unchanged = draftToPersonality(draft, stored.id, stored);
    expect(unchanged).not.toHaveProperty("memoryEnabled");
    expect(unchanged).not.toHaveProperty("respectGlobalAppendPrompt");

    const off = draftToPersonality(
      { ...draft, memoryEnabled: false, respectGlobalAppendPrompt: false },
      stored.id,
      stored,
    );
    expect(off.memoryEnabled).toBe(false);
    expect(off.respectGlobalAppendPrompt).toBe(false);
  });

  it("reads a template that names no model as no model chosen", () => {
    const modelless = { ...stored, model: undefined } as AgentProfile;
    expect(personalityToDraft(modelless).model).toBe("");
  });

  it("carries pinned provider feature values both ways", () => {
    const draft = personalityToDraft(stored);
    expect(draft.featureValues).toEqual({ fast_mode: true });

    const saved = draftToPersonality(
      { ...draft, featureValues: { fast_mode: false } },
      stored.id,
      stored,
    );
    expect(saved.featureValues).toEqual({ fast_mode: false });

    // Pinning nothing stores nothing, rather than a dead empty map.
    expect(
      draftToPersonality({ ...draft, featureValues: {} }, stored.id, stored),
    ).not.toHaveProperty("featureValues");
  });

  it("carries notes both ways", () => {
    const draft = personalityToDraft({ ...stored, notes: "Release reviews only." });
    expect(draft.notes).toBe("Release reviews only.");
    expect(draftToPersonality({ ...draft, notes: "  " }, stored.id, stored)).not.toHaveProperty(
      "notes",
    );
  });
});
