import { z } from "zod";
import type { ProfileRole } from "@otto-code/protocol/messages";
import { normalizeProfileRoles, PROFILE_ROLE_INFO } from "@otto-code/protocol/agent-profiles";
import type { StructuredTextGeneration } from "../session/checkout/git-metadata-generator.js";
import { isStructuredGenerationFailure } from "./agent-response-loop.js";

/**
 * Authors a personality PROFILE (the prose `personalityPrompt` that shapes how
 * an agent behaves) from the only three things the editor knows before one
 * exists: the handle, the roles it will be spawned for, and its two spinner
 * colors.
 *
 * The point is not flavor for its own sake. A personality prompt rides in every
 * request that agent makes (docs/token-economy.md), so it has to earn its tokens
 * by making the agent BETTER at the roles it was created for: a researcher that
 * is thorough and cites what it found, a judger that will say the uncomfortable
 * thing, a coder that verifies before claiming done. `ROLE_VIRTUES` is that
 * contract: the model is told to build the character out of those traits, and is
 * explicitly forbidden the ones that would undercut the job.
 *
 * One structured pass returns the character's PARTS; the prose is assembled here
 * so every profile lands in the same compact shape (a model left to write the
 * whole prompt drifts into a page of backstory nobody wants in a system prompt).
 */
export interface PersonalityProfileGenerator {
  /**
   * Returns the assembled personality prompt, or null when generation fails
   * with nothing usable. Not cached: the caller drops it into the editor.
   */
  generate(input: {
    name: string;
    roles?: string[];
    glowA?: string;
    glowB?: string;
    cwd?: string;
  }): Promise<string | null>;
}

// What a GREAT holder of each role is like: the positive traits the generated
// character must be built from, plus the failure mode that role must never have.
// Exhaustive by ProfileRole so adding a role fails typecheck here rather
// than silently producing a character with no idea what its job is.
const ROLE_VIRTUES: Readonly<Record<ProfileRole, string>> = {
  chatter:
    "reads the room, asks the one clarifying question that actually matters, and keeps the human oriented; never goes silent mid-task or buries the answer",
  artificer:
    "cares how the finished artifact holds up (structure, polish, reuse) and will not hand over a half-built thing",
  scheduler:
    "thinks in calendars and consequences: precise about time, wary of anything recurring, explicit about what fires when",
  researcher:
    "patient and exhaustive; reads the source, names files and references, and would rather say 'not found' than guess; never rushes or skips a check",
  planner:
    "sequences before anything moves; surfaces dependencies and risks up front and refuses to hand-wave a step",
  judger:
    "hard to impress and specific in criticism; will say the uncomfortable thing and never rubber-stamps work to be agreeable",
  advisor:
    "weighs the trade-offs out loud, then commits to ONE recommendation and says what would change its mind; never hedges into uselessness",
  coder:
    "works in small verified steps, reads the surrounding code before writing, runs the check, and never claims done without proof",
  designer:
    "notices spacing, rhythm and wording; opinionated about craft and allergic to templated defaults",
  writer:
    "fast and plain, ruthless about cutting words, and lands the tone exactly, with no filler and no throat-clearing",
  orchestrator:
    "decisive; splits the work on purpose, keeps every thread tied to the goal, and delegates instead of hoarding the interesting parts",
};

// The character sheet the model fills in. Ours, not a provider's: each field is
// a part we assemble, and the bounds keep a personality prompt from bloating the
// per-request cost of every agent that wears it.
const PROFILE_SCHEMA = z.object({
  // A named character reads as a person and gives the model something to hold on
  // to. The enum keeps the cast varied and the assembled prose grammatical;
  // "vary this across personalities" lives in the prompt.
  pronouns: z.enum(["she/her", "he/him", "they/them"]),
  // One clause: who this is. "a meticulous archivist who hates loose ends".
  archetype: z.string().trim().min(1).max(140),
  // The working traits: where the role virtues have to show up.
  traits: z.array(z.string().trim().min(1).max(180)).min(3).max(5),
  // How it behaves toward teammates: handoffs, disagreement, credit.
  teamwork: z.string().trim().min(1).max(240),
  // Speaking style. This is also what the voice-cue writer builds on later.
  speech: z.string().trim().min(1).max(200),
  // One memorable, harmless habit. Character, not noise.
  quirk: z.string().trim().min(1).max(160),
  motto: z.string().trim().max(100).optional(),
});

type PersonalityProfileParts = z.infer<typeof PROFILE_SCHEMA>;

// One name per 30° of hue, starting at red (0°). Indexed by round(hue / 30) % 12.
const HUE_NAMES = [
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "mint",
  "cyan",
  "azure",
  "blue",
  "violet",
  "magenta",
  "rose",
] as const;

// Accepts the four forms the color wheel and hand-typed hex produce (#rgb,
// #rgba, #rrggbb, #rrggbbaa); alpha is dropped, since it says nothing about mood.
function expandHex(hex: string): string | null {
  if (hex.length === 3 || hex.length === 4) {
    return hex
      .slice(0, 3)
      .split("")
      .map((char) => char + char)
      .join("");
  }
  if (hex.length === 6 || hex.length === 8) {
    return hex.slice(0, 6);
  }
  return null;
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const full = expandHex(value.trim().replace(/^#/, ""));
  if (full === null || !/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/**
 * Hex → a plain-language color phrase ("deep violet", "pale cyan"). The model is
 * given the palette in words rather than raw hex: a color name carries the
 * temperature and energy we actually want it to read, and hex codes tempt it to
 * quote the value back in the profile.
 */
export function describeGlowColor(value: string): string | null {
  const rgb = parseHexColor(value);
  if (!rgb) {
    return null;
  }
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta < 0.04) {
    if (lightness > 0.85) return "near-white";
    if (lightness < 0.15) return "near-black";
    return "neutral grey";
  }
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  hue = (hue * 60 + 360) % 360;
  const name = HUE_NAMES[Math.round(hue / 30) % 12] ?? "blue";
  return `${describeTone(lightness, saturation)} ${name}`;
}

function describeTone(lightness: number, saturation: number): string {
  if (lightness > 0.75) return "pale";
  if (lightness < 0.3) return "deep";
  return saturation > 0.7 ? "vivid" : "muted";
}

function describePalette(a: string | null, b: string | null): string | null {
  if (a && b) {
    return a === b ? a : `${a} shading into ${b}`;
  }
  return a ?? b;
}

function paletteLine(glowA?: string, glowB?: string): string | null {
  const palette = describePalette(
    glowA ? describeGlowColor(glowA) : null,
    glowB ? describeGlowColor(glowB) : null,
  );
  if (!palette) {
    return null;
  }
  return (
    `Its spinner glows ${palette}. Read that palette as temperature and energy: cool colors suggest calm and precision, ` +
    `hot colors suggest drive and flair, pale suggests lightness, deep suggests gravity. NEVER mention colors in the profile itself.`
  );
}

function buildProfilePrompt(input: {
  name: string;
  roles: ProfileRole[];
  glowA?: string;
  glowB?: string;
}): string {
  const who = input.name.trim() || "this agent";
  const palette = paletteLine(input.glowA, input.glowB);
  const hasRoles = input.roles.length > 0;
  return [
    `You are casting a member of an AI coding team: a named agent that will work alongside other agents and a human.`,
    `Design its character. Someone else will turn what you write into the system prompt that agent runs under, so every trait you give it is a behavior it will actually have.`,
    "",
    `NAME: ${who}`,
    ...(hasRoles
      ? [
          "",
          `ROLES IT WILL BE SPAWNED FOR (the job it must be good at):`,
          ...input.roles.map(
            (role) =>
              `- ${role}: ${PROFILE_ROLE_INFO[role].guidance}\n  A great ${role} ${ROLE_VIRTUES[role]}.`,
          ),
        ]
      : ["", `ROLES: none specified. Make it a capable, adaptable generalist.`]),
    ...(palette ? ["", palette] : []),
    "",
    `HARD RULES:`,
    hasRoles
      ? `- Role fit comes first. Every trait must make ${who} BETTER at the roles above. A trait that would undercut the job is disqualified: no researcher who rushes or skips references, no judger who avoids conflict to be nice, no coder who claims done without checking, no planner who improvises past the plan.`
      : `- Every trait must make ${who} better at real work: careful, honest about uncertainty, finishes what it starts.`,
    `- It is a TEAMMATE. Say how it hands work off, how it disagrees, and how it treats the other agents' output. Collaborative, never territorial.`,
    `- Give it a gender and use the matching pronouns. Vary this; do not default to one gender for every character.`,
    `- Make it a specific person, not a job description: someone with a history, a temperament and a way of talking that a reader could pick out of a lineup. Its flaws must be charming, never harmful to the work.`,
    `- No fantasy powers, no violence, no self-aggrandizing "elite/world-class/10x" filler, no emoji.`,
    `- Write in plain English. Be concrete: "reads the failing test before touching the code" beats "detail-oriented".`,
    // A human reads this text in the editor, and this repo treats em-dash
    // density as the giveaway that a machine wrote something.
    `- Never use em-dashes or en-dashes. Use a colon, a semicolon, commas, parentheses, or two sentences.`,
    "",
    `Return JSON only, exactly these keys:`,
    `{`,
    `  "pronouns": "she/her" | "he/him" | "they/them",`,
    `  "archetype": "one clause naming who this is, e.g. 'a former archivist who cannot leave a loose end alone'",`,
    `  "traits": ["3-5 concrete working behaviors, each one sentence"],`,
    `  "teamwork": "one or two sentences on how it works with the rest of the team",`,
    `  "speech": "one sentence on how it talks: vocabulary, rhythm, attitude",`,
    `  "quirk": "one memorable, harmless habit",`,
    `  "motto": "a short line it lives by (optional)"`,
    `}`,
  ].join("\n");
}

/**
 * Assemble the parts into the stored personality prompt. Second person, because
 * this text is injected as the agent's own instructions; compact and sectioned,
 * because it is paid for on every request the agent makes.
 */
export function assemblePersonalityProfile(name: string, parts: PersonalityProfileParts): string {
  const who = name.trim() || "this agent";
  const sections = [
    `You are ${who} (${parts.pronouns}), ${parts.archetype}.`,
    ["How you work:", ...parts.traits.map((trait) => `- ${trait}`)].join("\n"),
    `With the team: ${parts.teamwork}`,
    `How you talk: ${parts.speech}`,
    `Quirk: ${parts.quirk}`,
  ];
  const motto = parts.motto?.trim();
  if (motto) {
    sections.push(`You live by: "${motto.replace(/^"|"$/g, "")}"`);
  }
  return sections.join("\n\n");
}

export function createPersonalityProfileGenerator(deps: {
  generation: Pick<StructuredTextGeneration, "generate">;
  /** cwd used for provider resolution when a caller supplies none. */
  fallbackCwd: () => string;
}): PersonalityProfileGenerator {
  return {
    async generate({ name, roles, glowA, glowB, cwd }) {
      const resolvedCwd = cwd?.trim() || deps.fallbackCwd();
      try {
        const parts = await deps.generation.generate({
          cwd: resolvedCwd,
          prompt: buildProfilePrompt({
            name,
            roles: normalizeProfileRoles(roles),
            ...(glowA ? { glowA } : {}),
            ...(glowB ? { glowB } : {}),
          }),
          schema: PROFILE_SCHEMA,
          schemaName: "AgentPersonalityProfile",
          agentTitle: "Personality writer",
        });
        return assemblePersonalityProfile(name, parts);
      } catch (error) {
        if (isStructuredGenerationFailure(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}
