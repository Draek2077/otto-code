import { z } from "zod";
import { CUE_MOMENTS, PERSONALITY_ROLES, type CueMoment } from "@otto-code/protocol/messages";
import {
  normalizePersonalityRoles,
  PERSONALITY_ROLE_INFO,
} from "@otto-code/protocol/agent-profiles";
import type { StructuredTextGeneration } from "../session/checkout/git-metadata-generator.js";
import { isStructuredGenerationFailure } from "./agent-response-loop.js";

/**
 * Short spoken "cue" lines for a personality's Visualizer node - a few
 * variations each for the lifecycle moments in CUE_MOMENTS. Authored by the
 * Writer mini-task chain (same routing as commit messages), flavored by the
 * persona's name + prompt. This is an editor-time action: the result is stored on the
 * personality (`voiceCues`) and read directly by the Visualizer at runtime.
 *
 * ONE pass authors all four moments. The editor used to fan out one request per
 * moment for a determinate progress bar, which cost four cold-start generations
 * and, worse, four independent readings of the persona, so the moments drifted
 * apart in character. A single call sees the whole cast sheet at once: it commits
 * to a `voice` line first (a cheap in-schema scratchpad we discard), then writes
 * every group against it, and can tell the four groups apart because it is
 * holding all four. The per-moment path stays only for old clients that still
 * send `moment`.
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
  waiting: string[];
  done: string[];
};

// The moment vocabulary is protocol-owned (the wire enum, the editor, and the
// Visualizer all share it); re-exported here for existing consumers.
export { CUE_MOMENTS, type CueMoment };

export interface VoiceCueGenerator {
  /**
   * Generate a cue pool for a persona described inline (so it works for an
   * unsaved editor draft). Returns null when generation fails with no usable
   * lines. Not cached - the caller stores the result on the personality.
   *
   * Pass `moment` to author only that one group (a focused, single-moment
   * prompt) - the other groups come back empty. This is how the editor drives a
   * per-moment progress bar and keeps each moment's lines distinct. Omit
   * `moment` to author every moment at once (the legacy all-in-one path).
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
  // A one-line characterization of how this character talks, written BEFORE the
  // lines. It is a forcing function, not data: making the model commit to a
  // voice first is what stops the four groups from sliding back into neutral
  // agent-speak. Optional so a weaker local model that skips it still yields
  // usable cues instead of failing the whole generation; discarded on the way
  // out (nothing downstream stores it).
  voice: z.string().trim().max(240).optional(),
  join: GROUP,
  thinking: GROUP,
  waiting: GROUP,
  done: GROUP,
});
// Single-moment response - just the lines for the one moment being authored.
const SINGLE_MOMENT_SCHEMA = z.object({ lines: GROUP });

interface MomentSpec {
  // Human word for the moment, used in the prompt heading.
  label: string;
  // What is TRUE at this exact instant - the discriminator that keeps the
  // groups from blurring into each other.
  meaning: string;
  // The stock lines everyone reaches for at this moment. Fed to the model as a
  // BAN list, not as examples: when these were shown as "good examples (don't
  // copy)" the model returned them or trivial rewordings almost every time, so
  // every personality ended up with the same cue pool.
  overused: string[];
}

// Each moment is defined by what is true at that instant, plus the stock lines
// to ban. The banned sets deliberately share no phrasing across moments so the
// model doesn't collapse them together (the old prompt's "All set" read as done
// but works equally as start/ack - exactly the ambiguity we're avoiding here).
const MOMENT_SPECS: Record<CueMoment, MomentSpec> = {
  join: {
    label: "STARTING",
    meaning:
      "the agent has just picked up the task and is about to begin - nothing is done yet, and it hasn't started reasoning. Every line must sound like the very start of the work.",
    overused: ["On it", "Starting now", "Here we go", "Let's begin", "Picking this up"],
  },
  thinking: {
    label: "THINKING",
    meaning:
      "the agent is in the middle of the work, actively reasoning or figuring something out - it has already started but is NOT finished. Every line must sound like effort in progress.",
    overused: ["Let me think", "Digging in", "Working through this", "Hmm, one sec", "Still going"],
  },
  waiting: {
    label: "WAITING",
    meaning:
      "the agent has finished ITS OWN part of the turn but helpers it delegated to are still running, so it has nothing to do but wait on them - the work as a whole is NOT complete and it is not reasoning either. Every line must sound like idling on someone else, never like finality.",
    overused: ["Waiting on it", "Hang tight", "Almost there", "Any second now", "Just waiting"],
  },
  done: {
    label: "COMPLETED",
    meaning:
      "the agent has FINISHED the task and is handing back the result - the work is over. Every line must carry finality; a listener must be able to tell the work is complete, not starting or ongoing.",
    overused: ["Done", "Finished", "Wrapped up", "That's shipped", "All yours"],
  },
};

function personaBlock(name: string, prompt?: string, roles?: string[]): string[] {
  const persona = prompt?.trim();
  const known = normalizePersonalityRoles(roles);
  // A personality holding every role carries no information about what it does
  // - and the editor hands new personalities the full set by default - so
  // feeding that back as flavor is pure noise that dilutes the name/persona.
  const rolesAreDistinguishing = known.length > 0 && known.length < PERSONALITY_ROLES.length;
  return [
    `Name: ${name.trim() || "the agent"}`,
    persona ? `Persona: ${persona}` : `Persona: (no description - infer a tone from the name)`,
    ...(rolesAreDistinguishing
      ? [
          `Roles (what this agent is actually for; let the job color its word choice):`,
          // The role's own "why you'd choose me" blurb, so the writer knows what
          // the agent DOES rather than just the role's name.
          ...known.map((role) => `- ${role}: ${PERSONALITY_ROLE_INFO[role].guidance}`),
        ]
      : []),
  ];
}

// Shared rules for every line, regardless of moment. Kept terse because the
// model tends to over-produce; the hard constraints are the length and the
// "distinct per moment" rule that fixes the reported bug.
const LINE_RULES = [
  `Rules for every line:`,
  `- VERY short: 1–5 words, the kind of thing you'd blurt out loud.`,
  `- Casual and natural spoken English - no robotic phrasing, no emoji, no quotes, minimal punctuation.`,
  `- Each line must clearly belong to ITS moment and would sound wrong at the others. Do not reuse a generic line (like "All set", "Okay", "Ready") that could fit more than one moment.`,
  // The four rules below are the anti-sameness ones. Without them the model
  // returns the same neutral agent-speak for every personality, which is the
  // whole complaint: cues that don't sound like the character they belong to.
  `- This is THIS character talking, not a generic assistant. A stranger who knows the persona should be able to guess whose lines these are. If a line would fit any other agent unchanged, it is wrong - rewrite it.`,
  `- Lean hard into the persona's specific voice: its vocabulary, its attitude, its verbal habits, whatever it would actually care about. A blunt persona is blunt; a theatrical one is theatrical; a nervous one hedges.`,
  `- Vary the shape across the set - not four rewordings of one idea. Mix lengths, and mix forms (a fragment, an aside, a reaction, a muttered thought).`,
  `- Avoid stock agent phrasing. If the line sounds like default chatbot filler, it is too safe.`,
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
    `Write lines ${name.trim() || "the agent"} says OUT LOUD at exactly ONE moment: ${spec.label}.`,
    `At this moment, ${spec.meaning}`,
    `BANNED - these are the stock lines every agent uses. Do not output them, or near-variants of them: ${spec.overused.join(", ")}.`,
    "",
    ...LINE_RULES,
    "",
    `Give 4 distinct ${spec.label} variations, in ${name.trim() || "the agent"}'s voice.`,
    `Return JSON only: { "lines": [...] }.`,
  ].join("\n");
}

function buildCombinedPrompt(name: string, prompt?: string, roles?: string[]): string {
  const who = name.trim() || "the agent";
  const moment = (m: CueMoment): string => {
    const spec = MOMENT_SPECS[m];
    return `- "${m}" (${spec.label}): ${spec.meaning} BANNED (stock lines, do not output these or near-variants): ${spec.overused.join(", ")}.`;
  };
  return [
    `You are casting the spoken voice of ONE character: an AI coding agent whose short interjections play out loud while it works.`,
    "",
    `CHARACTER`,
    ...personaBlock(name, prompt, roles),
    "",
    `THE FOUR MOMENTS. ${who} speaks at each, and they must not blur together:`,
    moment("join"),
    moment("thinking"),
    moment("waiting"),
    moment("done"),
    "",
    ...LINE_RULES,
    "",
    // The scratchpad-first instruction. Everything above describes the character;
    // this makes the model state the voice in its own words before it writes a
    // line, which is what keeps all four groups sounding like the same person.
    `Work in this order:`,
    `1. Write "voice": one sentence describing how ${who} talks: vocabulary, rhythm, attitude, verbal habits. Be specific; this is the character's sound.`,
    `2. Write 4 lines for EACH of the four moments, every one of them obeying that "voice" sentence.`,
    `Across all 16 lines: no repeats, and no two lines that are the same idea reworded.`,
    "",
    `Return JSON only, exactly these keys:`,
    `{ "voice": "...", "join": [...], "thinking": [...], "waiting": [...], "done": [...] }`,
  ].join("\n");
}

// The model is told not to repeat itself; it repeats itself anyway, usually by
// reusing one good line at two moments, which is exactly the "these all sound
// the same" complaint. First writer of a line keeps it (CUE_MOMENTS order), and
// a group never empties: its own first line is kept even if a previous group
// already claimed it, since a moment with no lines is silent at playback.
function dedupeAcrossMoments(lines: VoiceCueLines): VoiceCueLines {
  const seen = new Set<string>();
  const result = emptyLines();
  const key = (line: string): string =>
    line
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  for (const moment of CUE_MOMENTS) {
    const texts = lines[moment].map((line) => line.trim()).filter((line) => line.length > 0);
    const kept = texts.filter((text) => !seen.has(key(text)));
    // Everything this moment produced was already claimed: keep its first line
    // anyway rather than leaving the moment silent at playback.
    const group = kept.length > 0 ? kept : texts.slice(0, 1);
    for (const text of group) {
      seen.add(key(text));
    }
    result[moment] = group;
  }
  return result;
}

function emptyLines(): VoiceCueLines {
  return { join: [], thinking: [], waiting: [], done: [] };
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
        // `voice` is the model's scratchpad: read for its effect on the lines,
        // then dropped; only the four groups are returned (and stored).
        const { join, thinking, waiting, done } = await deps.generation.generate({
          cwd: resolvedCwd,
          prompt: buildCombinedPrompt(name, prompt, roles),
          schema: VOICE_CUE_SCHEMA,
          schemaName: "VisualizerVoiceCues",
          agentTitle: "Voice cue writer",
        });
        return dedupeAcrossMoments({ join, thinking, waiting, done });
      } catch (error) {
        if (isStructuredGenerationFailure(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}
