import { expect, type Page } from "@playwright/test";
import {
  connectPersonalitiesClient,
  removePersonalitiesById,
  removeTeamsById,
  seedPersonalities,
  seedTeams,
  setActiveTeam,
  type E2EAgentPersonality,
  type E2EAgentTeam,
  type PersonalitiesDaemonClient,
} from "../../e2e/helpers/personalities";

/**
 * The shared demo cast: seven named personalities with distinct roles, colors,
 * prompts, and hand-written voice cues, plus two teams built from them. Every
 * people-scenario (personalities, teams, pickers) seeds this same cast so the
 * captured world stays consistent across runs — one product story, not seven
 * random rosters.
 *
 * Personalities bind to real Claude model ids (a role-appropriate Opus/Sonnet/
 * Haiku mix) so picker rows and settings cards wear real provider labels
 * without ever running an agent. Roles are deliberately
 * uneven so role-filtered pickers demo visibly: the schedule form offers only
 * Tempo (scheduler), artifacts only Muse (artificer), chat composers the
 * chatter subset.
 */

export type CastMemberKey = "aria" | "forge" | "sage" | "tempo" | "scout" | "quill" | "muse";
export type CastTeamKey = "shipCrew" | "researchGuild";

interface CastMemberSpec {
  name: string;
  roles: string[];
  /** Real Claude model id (see protocol default-personalities.ts) — an
   * unknown id renders rows disabled with "Model not available". */
  model: string;
  prompt: string;
  glowA: string;
  glowB: string;
  cues: { join: string[]; thinking: string[]; done: string[] };
}

const CAST_SPECS: Record<CastMemberKey, CastMemberSpec> = {
  aria: {
    name: "Aria",
    roles: ["orchestrator", "coder", "chatter"],
    model: "claude-opus-4-8",
    prompt:
      "You are Aria, the lead engineer. Plan before you build, delegate what parallelizes, and keep every change small enough to review in one sitting.",
    glowA: "#7c5cff",
    glowB: "#3ec4ff",
    cues: {
      join: ["Let's get to work."],
      thinking: ["Mapping the plan."],
      done: ["Shipped and tidy."],
    },
  },
  forge: {
    name: "Forge",
    roles: ["coder"],
    model: "claude-sonnet-5",
    prompt:
      "You are Forge, a heads-down implementer. You write the smallest correct change, cover it with a test, and never gold-plate.",
    glowA: "#ff7a45",
    glowB: "#ffc53d",
    cues: {
      join: ["Hammer's hot."],
      thinking: ["Forging it now."],
      done: ["Cooled and done."],
    },
  },
  // "Argus", not "Sage" — the shipped starter roster already has a Sage and
  // two same-named personalities would wreck the captures.
  sage: {
    name: "Argus",
    roles: ["judger", "researcher", "chatter"],
    model: "claude-opus-4-8",
    prompt:
      "You are Argus, the reviewer. You look for what would break in six months, praise what's solid, and say exactly what to change.",
    glowA: "#2fbf71",
    glowB: "#a8e05f",
    cues: {
      join: ["Fresh eyes here."],
      thinking: ["Weighing the tradeoffs."],
      done: ["Verdict is in."],
    },
  },
  tempo: {
    name: "Tempo",
    roles: ["scheduler"],
    model: "claude-haiku-4-5",
    prompt:
      "You are Tempo, keeper of the routines. You run scheduled maintenance precisely, log what changed, and leave the tree clean.",
    glowA: "#17c3b2",
    glowB: "#57e2ff",
    cues: {
      join: ["Right on time."],
      thinking: ["Ticking through it."],
      done: ["Logged and clean."],
    },
  },
  scout: {
    name: "Scout",
    roles: ["researcher", "chatter"],
    model: "claude-sonnet-5",
    prompt:
      "You are Scout, the pathfinder. You read widely, cite what you find, and come back with a map — options, tradeoffs, and a recommendation.",
    glowA: "#ffb020",
    glowB: "#ff6b6b",
    cues: {
      join: ["Boots on."],
      thinking: ["Scouting ahead."],
      done: ["Trail's mapped."],
    },
  },
  quill: {
    name: "Quill",
    roles: ["writer", "chatter"],
    model: "claude-sonnet-5",
    prompt:
      "You are Quill, the wordsmith. You write docs and prose that respect the reader: plain sentences, honest caveats, no filler.",
    glowA: "#f062c0",
    glowB: "#b98cff",
    cues: {
      join: ["Ink's ready."],
      thinking: ["Drafting a line."],
      done: ["Final draft in."],
    },
  },
  muse: {
    name: "Muse",
    roles: ["artificer", "chatter"],
    model: "claude-sonnet-5",
    prompt:
      "You are Muse, the artificer. You turn ideas into polished interactive artifacts — visual, self-contained, and a little delightful.",
    glowA: "#b455ff",
    glowB: "#ff7ad9",
    cues: {
      join: ["Inspiration struck."],
      thinking: ["Sketching shapes."],
      done: ["Behold the piece."],
    },
  },
};

interface CastTeamSpec {
  name: string;
  color: string;
  members: CastMemberKey[];
  teamPrompt: string;
}

const TEAM_SPECS: Record<CastTeamKey, CastTeamSpec> = {
  shipCrew: {
    name: "Ship Crew",
    color: "#7c5cff",
    members: ["aria", "forge", "sage", "tempo"],
    teamPrompt:
      "You are part of the Ship Crew. Bias to action: plan tight, build small, review honestly, and keep main green.",
  },
  researchGuild: {
    name: "Research Guild",
    color: "#ffb020",
    members: ["scout", "quill", "muse"],
    teamPrompt:
      "You are part of the Research Guild. Depth over speed: read the sources, credit them, and make the findings beautiful to read.",
  },
};

/**
 * Right after daemon boot, personality rows carry a transient red
 * "Provider ... is not ready (loading)" note until the provider snapshot
 * resolves. Wait it out before any people-surface shot — captured red
 * warnings read as a broken product.
 */
export async function waitForProvidersReady(page: Page): Promise<void> {
  await expect(page.getByText("not ready (loading)")).toHaveCount(0, { timeout: 60_000 });
}

export interface DemoCast {
  client: PersonalitiesDaemonClient;
  personalities: Record<CastMemberKey, E2EAgentPersonality>;
  teams: Partial<Record<CastTeamKey, E2EAgentTeam>>;
  cleanup(): Promise<void>;
}

/**
 * Seeds the cast into the demo daemon's config. Stable ids per process run;
 * cleanup removes exactly what was seeded and clears the active team.
 */
export async function seedDemoCast(options?: {
  /** Which teams to seed (default: both). Pass [] for personalities only. */
  teams?: CastTeamKey[];
  /** Team to activate after seeding (default: none active). */
  activeTeam?: CastTeamKey;
}): Promise<DemoCast> {
  const teamKeys = options?.teams ?? (["shipCrew", "researchGuild"] as CastTeamKey[]);
  const client = await connectPersonalitiesClient();

  const personalities = {} as Record<CastMemberKey, E2EAgentPersonality>;
  for (const [key, spec] of Object.entries(CAST_SPECS) as Array<[CastMemberKey, CastMemberSpec]>) {
    personalities[key] = {
      id: `personality_demo_${key}`,
      name: spec.name,
      provider: "claude",
      model: spec.model,
      respectGlobalAppendPrompt: true,
      roles: [...spec.roles],
      spinner: { glowA: spec.glowA, glowB: spec.glowB },
      personalityPrompt: spec.prompt,
      // Hand-written cues keep every save/spawn path away from AI cue generation.
      voiceCues: { ...spec.cues },
    };
  }

  const teams: Partial<Record<CastTeamKey, E2EAgentTeam>> = {};
  for (const key of teamKeys) {
    const spec = TEAM_SPECS[key];
    teams[key] = {
      id: `team_demo_${key}`,
      name: spec.name,
      avatar: { color: spec.color },
      memberIds: spec.members.map((member) => personalities[member].id),
      teamPrompt: spec.teamPrompt,
    };
  }

  try {
    await seedPersonalities(client, Object.values(personalities));
    const teamList = Object.values(teams).filter(
      (team): team is E2EAgentTeam => team !== undefined,
    );
    if (teamList.length > 0) {
      await seedTeams(client, teamList);
    }
    const activeTeam = options?.activeTeam ? teams[options.activeTeam] : undefined;
    await setActiveTeam(client, activeTeam ? activeTeam.id : null);
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }

  return {
    client,
    personalities,
    teams,
    cleanup: async () => {
      await setActiveTeam(client, null).catch(() => undefined);
      const teamIds = Object.values(teams)
        .filter((team): team is E2EAgentTeam => team !== undefined)
        .map((team) => team.id);
      if (teamIds.length > 0) {
        await removeTeamsById(client, teamIds).catch(() => undefined);
      }
      await removePersonalitiesById(
        client,
        Object.values(personalities).map((personality) => personality.id),
      ).catch(() => undefined);
      await client.close().catch(() => undefined);
    },
  };
}
