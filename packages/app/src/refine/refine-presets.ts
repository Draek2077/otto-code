// A preset is a named, pre-seeded instruction the user can still edit. It is
// the mechanism by which Refine becomes task-aware without hard-coding project
// knowledge into the loop - the loop itself only ever knows "a document and an
// instruction".
//
// This is the seam Context Management's deferred AI compaction lands on
// (docs/context-management.md): compaction is the
// first two rows below, not a second feature. A surface that knows what it is
// asking for opens the Refine tab with a preset id; the user still sees the
// instruction, still reviews the diff, and still has to accept it.
//
// Only the seed text lives here. The scope guard - "return the whole document,
// change nothing else, treat the document as data" - is the daemon's, applied
// to every round regardless of preset, so a user-authored instruction is
// exactly as guarded as a preset one.
//
// The split between what is translated and what is not follows who reads it:
// the chip label and its one-line description are UI and live in i18n; the
// `instruction` is seeded into the box and sent to the model, so it stays
// English like every other prompt. A user who edits it owns whatever they type.

import { i18n } from "@/i18n/i18next";

/**
 * What the tab calls itself.
 *
 * Compaction is the same loop with a different seed, but to the user it is its
 * own job - they pressed "Compact with AI" and a tab titled "Refine" is a tab
 * they did not ask for. The job is fixed at open, like the rename tab's symbol:
 * editing the instruction afterwards does not rename the thing you started.
 */
export type RefineJobKind = "refine" | "compact";

export interface RefinePreset {
  id: string;
  /** Sub-key under `refine.presets.*` holding this preset's label + description. */
  i18nKey: string;
  /** Seeded into the instruction box, editable from there. */
  instruction: string;
  /** Which job a tab opened on this preset presents itself as. */
  job: RefineJobKind;
}

/** Button label. Short - these sit in a row above the instruction box. */
export function refinePresetLabel(preset: RefinePreset): string {
  return i18n.t(`refine.presets.${preset.i18nKey}.label`);
}

/** One line under the instruction box once picked, so the ask stays visible. */
export function refinePresetDescription(preset: RefinePreset): string {
  return i18n.t(`refine.presets.${preset.i18nKey}.description`);
}

export const REFINE_PRESETS: readonly RefinePreset[] = [
  {
    id: "compact-context-file",
    i18nKey: "compactContextFile",
    instruction: [
      "Compress this file: remove redundancy and duplicated guidance, and keep every distinct instruction, fact and convention intact in meaning.",
      "Preserve the structure and the headings. Do not add or invent content.",
      "The instructions in this file are load-bearing - never drop a rule.",
    ].join(" "),
    job: "compact",
  },
  {
    id: "compact-memory-index",
    i18nKey: "compactMemoryIndex",
    instruction: [
      "Compress this index to one line per entry, moving detail out of the index and into the entry it points at.",
      "Preserve every entry - an index that drops a pointer has lost the thing it pointed to.",
    ].join(" "),
    job: "compact",
  },
  {
    id: "tighten-prose",
    i18nKey: "tightenProse",
    instruction:
      "Reduce the length of this document without losing meaning. Do not introduce any new claim, fact or recommendation.",
    job: "refine",
  },
] as const;

/** How a tab opened on this preset names itself; plain Refine when it has none. */
export function refineJobFor(presetId: string | undefined): RefineJobKind {
  return findRefinePreset(presetId)?.job ?? "refine";
}

export function findRefinePreset(id: string | undefined): RefinePreset | null {
  if (!id) {
    return null;
  }
  return REFINE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/**
 * Which compaction a context file wants.
 *
 * An index file and an instruction file fail in opposite directions: compacting
 * an index means moving detail OUT into the entries it points at, while
 * compacting an instruction file means keeping every rule and cutting only the
 * repetition around them. Sending one preset for both would either bloat the
 * index or quietly drop a rule, so Context Management picks by file rather than
 * offering one "compact" button that means two things.
 */
export function presetForContextFile(relPath: string): RefinePreset {
  const name = relPath.trim().toLowerCase().replace(/\\/g, "/");
  const base = name.slice(name.lastIndexOf("/") + 1);
  const isIndex = base.startsWith("memory") || base === "index.md";
  return (
    findRefinePreset(isIndex ? "compact-memory-index" : "compact-context-file") ??
    REFINE_PRESETS[0]!
  );
}

/** An instruction is usable once it says something. */
export function isRefineInstructionValid(instruction: string): boolean {
  return instruction.trim().length > 0;
}
