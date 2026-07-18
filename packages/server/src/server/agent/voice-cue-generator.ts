import { z } from "zod";
import { CUE_MOMENTS, type CueMoment } from "@otto-code/protocol/messages";
import type { StructuredTextGeneration } from "../session/checkout/git-metadata-generator.js";
import { isStructuredGenerationFailure } from "./agent-response-loop.js";

/**
 * Short spoken "cue" lines for a personality's Visualizer node — a few
 * variations each for three lifecycle moments. Authored by the Writer mini-task
 * chain (same routing as commit messages), flavored by the persona's name +
 * prompt. This is an editor-time action: the result is stored on the
 * personality (`voiceCues`) and read directly by the Visualizer at runtime.
 *
 * See docs/visualizer.md "Voice cues".
 */
// A `type` (not `interface`) on purpose: the wire's AgentPersonalityVoiceCues
// is a .passthrough() shape (unknown-key index signature), and only object
// type literals get the implicit index signature that makes this assignable.
// oxlint-disable-next-line typescript-eslint/consistent-type-definitions
export type VoiceCueLines = {
  join: string[];
  thinking: string[];
  done: string[];
};

// The moment vocabulary is protocol-owned (the wire enum, the editor, and the
// Visualizer all share it); re-exported here for existing consumers.
export { CUE_MOMENTS, type CueMoment };

export interface VoiceCueGenerator {
  /**
   * Generate a cue pool for a persona described inline (so it works for an
   * unsaved editor draft). Returns null when generation fails with no usable
   * lines. Not cached — the caller stores the result on the personality.
   *
   * Pass `moment` to author only that one group (a focused, single-moment
   * prompt) — the other two groups come back empty. This is how the editor
   * drives a per-moment progress bar and keeps each moment's lines distinct.
   * Omit `moment` to author all three at once (the legacy all-in-one path).
   */
  generate(input: {
    name: string;
    prompt?: string;
    cwd?: string;
    /** Persona roles (e.g. "researcher", "coder") to flavor the lines. */
    roles?: string[];
    moment?: CueMoment;
  }): Promise<VoiceCueLines | null>;
}

// Lines are read aloud, so keep them short and speakable. min/max bound the pool
// so a model can't return an empty group or a runaway list.
const LINE = z.string().trim().min(1).max(48);
const GROUP = z.array(LINE).min(1).max(8);
const VOICE_CUE_SCHEMA = z.object({
  join: GROUP,
  thinking: GROUP,
  done: GROUP,
});
// Single-moment response — just the lines for the one moment being authored.
const SINGLE_MOMENT_SCHEMA = z.object({ lines: GROUP });

interface MomentSpec {
  // Human word for the moment, used in the prompt heading.
  label: string;
  // What is TRUE at this exact instant — the discriminator that keeps the three
  // groups from blurring into each other.
  meaning: string;
  // Distinct example lines that could ONLY belong to this moment.
  examples: string[];
}

// Each moment is defined by what is true at that instant, plus examples that are
// unmistakably of that moment. The examples deliberately share no phrasing
// across moments so the model doesn't collapse them together (the old prompt's
// "All set" example read as done but works equally as start/ack — exactly the
// ambiguity we're avoiding here).
const MOMENT_SPECS: Record<CueMoment, MomentSpec> = {
  join: {
    label: "STARTING",
    meaning:
      "the agent has just picked up the task and is about to begin — nothing is done yet, and it hasn't started reasoning. Every line must sound like the very start of the work.",
    examples: ["On it", "Starting now", "Here we go", "Let's begin", "Picking this up"],
  },
  thinking: {
    label: "THINKING",
    meaning:
      "the agent is in the middle of the work, actively reasoning or figuring something out — it has already started but is NOT finished. Every line must sound like effort in progress.",
    examples: ["Let me think", "Digging in", "Working through this", "Hmm, one sec", "Still going"],
  },
  done: {
    label: "COMPLETED",
    meaning:
      "the agent has FINISHED the task and is handing back the result — the work is over. Every line must carry finality; a listener must be able to tell the work is complete, not starting or ongoing.",
    examples: ["Done", "Finished", "Wrapped up", "That's shipped", "All yours"],
  },
};

function personaBlock(name: string, prompt?: string, roles?: string[]): string[] {
  const persona = prompt?.trim();
  const cleanRoles = (roles ?? []).map((role) => role.trim()).filter((role) => role.length > 0);
  return [
    `Name: ${name.trim() || "the agent"}`,
    persona ? `Persona: ${persona}` : `Persona: (no description — infer a tone from the name)`,
    ...(cleanRoles.length > 0
      ? [`Roles: ${cleanRoles.join(", ")} (let what the agent does color its word choice)`]
      : []),
  ];
}

// Shared rules for every line, regardless of moment. Kept terse because the
// model tends to over-produce; the hard constraints are the length and the
// "distinct per moment" rule that fixes the reported bug.
const LINE_RULES = [
  `Rules for every line:`,
  `- VERY short: 1–4 words, the kind of thing you'd blurt out loud.`,
  `- Casual and natural spoken English — no robotic phrasing, no emoji, no quotes, minimal punctuation.`,
  `- Match the persona's tone (a playful persona is playful; a terse one is clipped).`,
  `- Each line must clearly belong to ITS moment and would sound wrong at the other two. Do not reuse a generic line (like "All set", "Okay", "Ready") that could fit more than one moment.`,
];

function buildMomentPrompt(
  name: string,
  moment: CueMoment,
  prompt?: string,
  roles?: string[],
): string {
  const spec = MOMENT_SPECS[moment];
  return [
    `You are writing short spoken interjections for an AI coding agent's on-screen voice.`,
    "",
    ...personaBlock(name, prompt, roles),
    "",
    `Write lines the agent says OUT LOUD at exactly ONE moment: ${spec.label}.`,
    `At this moment, ${spec.meaning}`,
    `Good examples of ${spec.label} lines (write new ones in the persona's voice, don't copy these): ${spec.examples.join(", ")}.`,
    "",
    ...LINE_RULES,
    "",
    `Give 4 distinct ${spec.label} variations.`,
    `Return JSON only: { "lines": [...] }.`,
  ].join("\n");
}

function buildCombinedPrompt(name: string, prompt?: string, roles?: string[]): string {
  const moment = (m: CueMoment): string => {
    const spec = MOMENT_SPECS[m];
    return `- "${m}" (${spec.label}): ${spec.meaning} Examples: ${spec.examples.join(", ")}.`;
  };
  return [
    `You are writing short spoken interjections for an AI coding agent's on-screen voice.`,
    "",
    ...personaBlock(name, prompt, roles),
    "",
    `Write lines the agent says OUT LOUD at three DISTINCT moments:`,
    moment("join"),
    moment("thinking"),
    moment("done"),
    "",
    ...LINE_RULES,
    "",
    `Give 4 distinct variations for each moment, matching the persona's tone.`,
    `Return JSON only: { "join": [...], "thinking": [...], "done": [...] }.`,
  ].join("\n");
}

function emptyLines(): VoiceCueLines {
  return { join: [], thinking: [], done: [] };
}

export function createVoiceCueGenerator(deps: {
  generation: Pick<StructuredTextGeneration, "generate">;
  /** cwd used for provider resolution when a caller supplies none. */
  fallbackCwd: () => string;
}): VoiceCueGenerator {
  return {
    async generate({ name, prompt, cwd, roles, moment }) {
      const resolvedCwd = cwd?.trim() || deps.fallbackCwd();
      try {
        if (moment) {
          const result = await deps.generation.generate({
            cwd: resolvedCwd,
            prompt: buildMomentPrompt(name, moment, prompt, roles),
            schema: SINGLE_MOMENT_SCHEMA,
            schemaName: "VisualizerVoiceCue",
            agentTitle: "Voice cue writer",
          });
          return { ...emptyLines(), [moment]: result.lines };
        }
        return await deps.generation.generate({
          cwd: resolvedCwd,
          prompt: buildCombinedPrompt(name, prompt, roles),
          schema: VOICE_CUE_SCHEMA,
          schemaName: "VisualizerVoiceCues",
          agentTitle: "Voice cue writer",
        });
      } catch (error) {
        if (isStructuredGenerationFailure(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}
