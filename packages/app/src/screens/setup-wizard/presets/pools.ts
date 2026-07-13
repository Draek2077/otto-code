/**
 * Randomization pools for team generation: names (by gender), spinner color
 * pairs, and TTS voices (by gender). The persona prose is fixed per variation;
 * these are the parts that randomize so two draws of the same blueprint still
 * feel like different people.
 *
 * Names are drawn *without replacement* within a team (no two members share a
 * name). Colors are drawn spread around the hue wheel so members stay visually
 * distinct. Voices are a soft binding — an unavailable voice degrades to the
 * host default at playback, it never takes a personality out of commission.
 */

import type { AgentPersonality } from "@otto-code/protocol/messages";
import type { NameGender } from "./types";

// ~20 names per pool. Kept broad and internationally varied; a variation's
// `gender` decides which pool to draw from, the specific name is random.
export const NAME_POOLS: Record<NameGender, readonly string[]> = {
  m: [
    "Arlo",
    "Beckett",
    "Cyrus",
    "Dmitri",
    "Elias",
    "Felix",
    "Idris",
    "Jonas",
    "Kai",
    "Leon",
    "Mateo",
    "Nikolai",
    "Omar",
    "Rafael",
    "Soren",
    "Tobias",
    "Viktor",
    "Wesley",
    "Xander",
    "Yusuf",
  ],
  f: [
    "Astrid",
    "Bianca",
    "Camila",
    "Delia",
    "Esme",
    "Freya",
    "Gia",
    "Hana",
    "Ines",
    "Juno",
    "Kira",
    "Lena",
    "Mira",
    "Nadia",
    "Priya",
    "Rosa",
    "Sana",
    "Talia",
    "Yara",
    "Zoe",
  ],
  n: [
    "Ari",
    "Blue",
    "Cass",
    "Dune",
    "Echo",
    "Frankie",
    "Gray",
    "Haven",
    "Indigo",
    "Jai",
    "Kit",
    "Lux",
    "Marlo",
    "Nico",
    "Onyx",
    "Quinn",
    "Reese",
    "Sage",
    "Vesper",
    "Wren",
  ],
};

// Spinner glow pairs (glowA/glowB), hue-spread so a team of them reads as a
// varied set. Drawn without replacement per team.
export const COLOR_PAIRS: readonly AgentPersonality["spinner"][] = [
  { glowA: "#4F46E5", glowB: "#F59E0B" },
  { glowA: "#14B8A6", glowB: "#8B5CF6" },
  { glowA: "#F43F5E", glowB: "#FBBF24" },
  { glowA: "#EC4899", glowB: "#06B6D4" },
  { glowA: "#22C55E", glowB: "#A3E635" },
  { glowA: "#64748B", glowB: "#38BDF8" },
  { glowA: "#F97316", glowB: "#EF4444" },
  { glowA: "#8B5CF6", glowB: "#EC4899" },
  { glowA: "#0EA5E9", glowB: "#22D3EE" },
  { glowA: "#10B981", glowB: "#3B82F6" },
  { glowA: "#EAB308", glowB: "#84CC16" },
  { glowA: "#D946EF", glowB: "#6366F1" },
  { glowA: "#F43F5E", glowB: "#8B5CF6" },
  { glowA: "#06B6D4", glowB: "#10B981" },
  { glowA: "#F59E0B", glowB: "#DC2626" },
  { glowA: "#3B82F6", glowB: "#A855F7" },
  { glowA: "#EC4899", glowB: "#F97316" },
  { glowA: "#14B8A6", glowB: "#EAB308" },
];

// Kokoro v1.0 (kokoro-multi-lang-v1_0) voice names by gender. Soft binding.
const KOKORO_V1_MODEL = "kokoro-multi-lang-v1_0";

const VOICE_NAMES: Record<NameGender, readonly string[]> = {
  m: ["am_puck", "am_echo", "am_onyx", "am_fenrir"],
  f: ["af_heart", "af_nova", "bf_emma", "af_bella"],
  // No dedicated neutral bank in Kokoro; spread across both so a neutral persona
  // still gets a stable voice rather than none.
  n: ["af_nova", "am_echo", "af_heart", "am_puck"],
};

export function voiceForGender(gender: NameGender, index: number): AgentPersonality["voice"] {
  const bank = VOICE_NAMES[gender];
  const name = bank[index % bank.length];
  return { provider: "local", model: KOKORO_V1_MODEL, name };
}
