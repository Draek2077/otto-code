/**
 * The editor draft for one stored agent template, and the two conversions
 * between it and the wire shape.
 *
 * Pure and component-free on purpose: the round-trip is where a template can
 * silently lose data, so it has to be testable without standing up the editor.
 * The UI label is "Personality"; the stored type is Paseo's `AgentProfile`.
 */

import { CUE_MOMENTS, type CueMoment } from "@otto-code/protocol/messages";
import type { AgentProfile, PersonalityRole } from "@otto-code/protocol/messages";
import { normalizePersonalityRoles } from "@otto-code/protocol/agent-profiles";
import { parseEffortLevel } from "@otto-code/protocol/effort";

export const DEFAULT_GLOW_A = "#4ec4ff";
export const DEFAULT_GLOW_B = "#e14fe8";

export interface CueLineDraft {
  /** Stable key for the list editor; never persisted. */
  id: string;
  text: string;
}

// One editable line list per protocol cue moment - a Record so adding a moment
// to CUE_MOMENTS lights up the whole editor without touching this shape.
export type DraftVoiceCues = Record<CueMoment, CueLineDraft[]>;

let cueLineSeq = 0;
export function newCueLine(text: string): CueLineDraft {
  cueLineSeq += 1;
  return { id: `cue_${cueLineSeq}`, text };
}

export function buildDraftVoiceCues(lines: (moment: CueMoment) => CueLineDraft[]): DraftVoiceCues {
  const draft = {} as DraftVoiceCues;
  for (const moment of CUE_MOMENTS) {
    draft[moment] = lines(moment);
  }
  return draft;
}

export function emptyDraftVoiceCues(): DraftVoiceCues {
  return buildDraftVoiceCues(() => []);
}

export function draftVoiceCuesFrom(cues: AgentProfile["voiceCues"]): DraftVoiceCues {
  return buildDraftVoiceCues((moment) => {
    const group: unknown = cues?.[moment];
    return Array.isArray(group) ? group.map((text) => newCueLine(String(text))) : [];
  });
}

// Trim + drop blank lines; returns undefined when every group is empty (so the
// template stores no voiceCues at all rather than empty arrays).
export function draftVoiceCuesToPersistable(
  cues: DraftVoiceCues,
): AgentProfile["voiceCues"] | undefined {
  const persistable: Record<string, string[]> = {};
  for (const moment of CUE_MOMENTS) {
    const lines = cues[moment].map((line) => line.text.trim()).filter((text) => text.length > 0);
    if (lines.length > 0) {
      persistable[moment] = lines;
    }
  }
  return Object.keys(persistable).length > 0 ? persistable : undefined;
}

export function draftVoiceCuesAreEmpty(cues: DraftVoiceCues): boolean {
  return draftVoiceCuesToPersistable(cues) === undefined;
}

export interface PersonalityDraft {
  name: string;
  provider: string;
  model: string;
  modeId: string; // "" = provider default
  /**
   * The picked thinking option, as one field. It lands on the wire as EITHER
   * `effortLevel` or `thinkingOptionId` depending on what it is - see
   * draftToPersonality. "" = none.
   */
  effort: string;
  personalityPrompt: string;
  /** Free text surfaced to orchestrating agents by list_agent_profiles. */
  notes: string;
  respectGlobalAppendPrompt: boolean;
  /** Whether this personality accrues lessons across sessions. Default on. */
  memoryEnabled: boolean;
  roles: PersonalityRole[];
  /** Icon registry key and identity colour; "" draws the defaults. */
  icon: string;
  color: string;
  glowA: string;
  glowB: string;
  /** NonNullable so "no voice" is exactly null, never a second absent value. */
  voice: NonNullable<AgentProfile["voice"]> | null;
  /** Provider feature toggles this template pins; empty = provider defaults. */
  featureValues: Record<string, unknown>;
  // Pre-generated (editable) spoken cue lines, always present as arrays for
  // simple list editing; persisted only when non-empty.
  voiceCues: DraftVoiceCues;
}

export function personalityToDraft(personality: AgentProfile): PersonalityDraft {
  return {
    name: personality.name,
    provider: personality.provider,
    // A template may name no model ("use the provider's default"); the editor
    // shows that as no model chosen rather than inventing one.
    model: personality.model ?? "",
    modeId: personality.modeId ?? "",
    // A pinned provider-specific id wins over the canonical rung, matching how
    // the daemon resolver reads the pair.
    effort: personality.thinkingOptionId ?? personality.effortLevel ?? "",
    personalityPrompt: personality.personalityPrompt ?? "",
    notes: personality.notes ?? "",
    respectGlobalAppendPrompt: personality.respectGlobalAppendPrompt ?? true,
    // Absent means on: memory costs nothing until a lesson exists, so the switch
    // is there to stop a personality accruing, not to start it.
    memoryEnabled: personality.memoryEnabled ?? true,
    roles: normalizePersonalityRoles(personality.roles),
    icon: personality.icon ?? "",
    color: personality.color ?? "",
    glowA: personality.spinner?.glowA ?? DEFAULT_GLOW_A,
    glowB: personality.spinner?.glowB ?? DEFAULT_GLOW_B,
    voice: personality.voice ?? null,
    featureValues: personality.featureValues ?? {},
    voiceCues: draftVoiceCuesFrom(personality.voiceCues),
  };
}

/**
 * Rebuild a stored template from the editor draft.
 *
 * `previous` is the entry being edited, spread in FIRST so anything this editor
 * does not model survives a round-trip. The schema is `.passthrough()`, so that
 * includes whatever a newer daemon has written and this build has never heard
 * of. Rebuilding from scratch would silently drop all of it the first time
 * someone opened an imported template and pressed Save.
 *
 * The editor's own fields are then set or deleted outright, never merged, so
 * clearing one in the form actually clears it on the wire.
 */
export function draftToPersonality(
  draft: PersonalityDraft,
  id: string,
  previous: AgentProfile | undefined,
): AgentProfile {
  const personality: AgentProfile = {
    ...previous,
    id,
    name: draft.name.trim(),
    provider: draft.provider,
    model: draft.model,
    roles: draft.roles,
    spinner: { glowA: draft.glowA.trim(), glowB: draft.glowB.trim() },
  };
  setOrDelete(personality, "icon", draft.icon || undefined);
  setOrDelete(personality, "color", draft.color || undefined);
  // One control, two wire fields. A canonical rung ("high") stays in
  // `effortLevel`, which is portable: the daemon re-maps it against whatever
  // model is bound at spawn. Anything else is a provider-specific option id
  // that the canonical scale cannot name (Claude's "ultracode"), so it is
  // pinned exactly in `thinkingOptionId`. Only one is ever set.
  const effort = draft.effort.trim();
  const canonical = effort ? parseEffortLevel(effort) : null;
  setOrDelete(personality, "effortLevel", canonical ?? undefined);
  setOrDelete(personality, "thinkingOptionId", effort && !canonical ? effort : undefined);
  setOrDelete(personality, "modeId", draft.modeId || undefined);
  setOrDelete(personality, "personalityPrompt", draft.personalityPrompt.trim() || undefined);
  setOrDelete(personality, "notes", draft.notes.trim() || undefined);
  setOrDelete(personality, "voice", draft.voice ?? undefined);
  // An empty map is stored as absent, so a template that pins nothing does not
  // carry a dead key and an older daemon sees what it saw before.
  setOrDelete(
    personality,
    "featureValues",
    Object.keys(draft.featureValues).length > 0 ? draft.featureValues : undefined,
  );
  setOrDelete(personality, "voiceCues", draftVoiceCuesToPersistable(draft.voiceCues));
  // Both switches default to ON, and both are written only when OFF: the
  // default state stays absent on the wire, so an older daemon reading this
  // roster sees exactly what it saw before, and re-saving an untouched template
  // does not rewrite it.
  setOrDelete(
    personality,
    "respectGlobalAppendPrompt",
    draft.respectGlobalAppendPrompt ? undefined : false,
  );
  setOrDelete(personality, "memoryEnabled", draft.memoryEnabled ? undefined : false);
  return personality;
}

// An editor-owned optional is SET or DELETED, never left over from `previous`.
// Emptying a field in the form has to reach the wire as absent, which a plain
// "assign when truthy" would not do once the previous value is spread in.
function setOrDelete<K extends keyof AgentProfile>(
  target: AgentProfile,
  key: K,
  value: AgentProfile[K] | undefined,
): void {
  if (value === undefined) {
    delete target[key];
    return;
  }
  target[key] = value;
}
