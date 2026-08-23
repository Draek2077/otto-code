import { z } from "zod";

/**
 * Otto agent-personality wire schemas. Kept out of agent-personalities.ts because that module imports from messages.ts, and out of messages.ts because personalities are a fork-only capability.
 */

// Canonical personality roles, in display order. Kept as an exported const so
// the daemon and app share one vocabulary, but the wire schema stores roles as
// plain strings (below) - adding a role later must never break an older peer's
// parsing. Consumers filter incoming role arrays to this known set. The retired
// "worker" role is mapped to "coder" on the way in (see LEGACY_ROLE_ALIASES in
// agent-personalities.ts) so personalities persisted before the split keep their
// role rather than silently losing it.
export const PERSONALITY_ROLES = [
  // Surfaces - the interactive / host-facing entry points.
  "chatter",
  "artificer",
  "scheduler",
  // Thinking workers - read-only, return structured findings, never edit.
  "researcher",
  "planner",
  "judger",
  "advisor",
  // Making workers - produce code, design, or short text.
  "coder",
  "designer",
  "writer",
  // Conductor - the sole role whose whole job is planning and driving a team.
  "orchestrator",
] as const;

export type PersonalityRole = (typeof PERSONALITY_ROLES)[number];

// Plain strings on the wire, like personality roles and effort levels, so the
// daemon can grow the vocabulary without breaking old peers. Logical values:
// scope "project" | "global"; source "agent" | "user" | "review" | "transfer".
export const PersonalityMemoryEntrySchema = z
  .object({
    id: z.string(),
    text: z.string(),
    scope: z.string(),
    // Absolute, daemon-side. Present only on project-scoped entries.
    projectRoot: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    source: z.string(),
    // How many times the lesson has been restated. Drives injection order and
    // is shown in the brief, because a repeatedly-relearned gotcha is stronger
    // evidence than a one-off observation.
    reinforcedCount: z.number().optional(),
    transferredFrom: z.string().optional(),
  })
  .passthrough();

export const PersonalityMemoryListRequestMessageSchema = z.object({
  type: z.literal("personality.memory.list.request"),
  requestId: z.string(),
  personalityId: z.string(),
  // Which project's lessons count as in-scope for the returned brief. Prefer
  // `workspaceId` and let the daemon resolve the root: a client computing repo
  // roots would disagree with the daemon the moment a worktree is involved.
  workspaceId: z.string().optional(),
  // Explicit root, for callers with no workspace. Ignored when `workspaceId`
  // resolves. Omitted (with no workspace) means global lessons only.
  projectRoot: z.string().optional(),
});

export const PersonalityMemoryListResponseMessageSchema = z.object({
  type: z.literal("personality.memory.list.response"),
  payload: z.object({
    requestId: z.string(),
    personalityId: z.string(),
    personalityName: z.string(),
    /** Whether this personality is accruing (the `memoryEnabled` switch). */
    enabled: z.boolean(),
    /** Every stored entry, including other projects' - the UI shows them all. */
    entries: z.array(PersonalityMemoryEntrySchema),
    // The EXACT text the daemon would inject for `projectRoot`, not a
    // reconstruction. Memory is only trustworthy if it is inspectable, and the
    // only way the shown text cannot drift from the injected text is for both
    // to come from one composer.
    brief: z.string(),
    briefTokens: z.number(),
    /** Entries the injection budget cut, so the UI can say so. */
    briefOmittedCount: z.number().optional(),
    // The root the brief was composed for, so the UI can tell a project-scoped
    // entry that applies here from one belonging to another project. Without it
    // every project entry looks the same and an empty brief next to a list of
    // lessons reads as a bug. Absent when the request named no workspace.
    projectRoot: z.string().optional(),
  }),
});

// One write RPC covers add / edit / delete: no `entryId` = add a new lesson,
// `drop: true` = forget one. The user-facing editing path from Context
// Management (charter §2.4).
export const PersonalityMemoryUpdateRequestMessageSchema = z.object({
  type: z.literal("personality.memory.update.request"),
  requestId: z.string(),
  personalityId: z.string(),
  entryId: z.string().optional(),
  text: z.string().optional(),
  scope: z.string().optional(),
  // Which project a `scope: "project"` write binds to. Same rule as the list
  // request: prefer `workspaceId` and let the daemon resolve the root, because a
  // project-scoped entry whose root does not match the daemon's resolution is
  // filtered out of every brief and is therefore stored but never sent.
  workspaceId: z.string().optional(),
  // Explicit root, for callers with no workspace. Ignored when `workspaceId`
  // resolves.
  projectRoot: z.string().optional(),
  drop: z.boolean().optional(),
});

export const PersonalityMemoryUpdateResponseMessageSchema = z.object({
  type: z.literal("personality.memory.update.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    error: z.string().optional(),
  }),
});

// Deleting a personality must never silently destroy what it learned, so the
// delete flow resolves here first: `mode: "transfer"` moves the lessons to
// `toPersonalityId` (merging near-duplicates), `mode: "delete"` discards them.
export const PersonalityMemoryTransferRequestMessageSchema = z.object({
  type: z.literal("personality.memory.transfer.request"),
  requestId: z.string(),
  fromPersonalityId: z.string(),
  toPersonalityId: z.string().optional(),
  mode: z.string(),
});

export const PersonalityMemoryTransferResponseMessageSchema = z.object({
  type: z.literal("personality.memory.transfer.response"),
  payload: z.object({
    requestId: z.string(),
    ok: z.boolean(),
    /** Entries that landed as new rows in the destination. */
    transferred: z.number().optional(),
    /** Entries that merged into a lesson the destination already knew. */
    merged: z.number().optional(),
    error: z.string().optional(),
  }),
});

// Per-personality lesson counts. Its own RPC over its own file, mirroring
// agentPersonalities.get_stats - counts must not ride the daemon-config
// broadcast, or every recorded lesson would fan a config change to every client.
export const PersonalityMemoryStatsRequestMessageSchema = z.object({
  type: z.literal("personality.memory.stats.request"),
  requestId: z.string(),
});

export const PersonalityMemoryStatsResponseMessageSchema = z.object({
  type: z.literal("personality.memory.stats.response"),
  payload: z.object({
    requestId: z.string(),
    counts: z.record(z.string(), z.number()),
  }),
});

export type PersonalityMemoryEntryPayload = z.infer<typeof PersonalityMemoryEntrySchema>;

export type PersonalityMemoryListResponseMessage = z.infer<
  typeof PersonalityMemoryListResponseMessageSchema
>;

export type PersonalityMemoryUpdateResponseMessage = z.infer<
  typeof PersonalityMemoryUpdateResponseMessageSchema
>;

export type PersonalityMemoryTransferResponseMessage = z.infer<
  typeof PersonalityMemoryTransferResponseMessageSchema
>;

export type PersonalityMemoryStatsResponseMessage = z.infer<
  typeof PersonalityMemoryStatsResponseMessageSchema
>;

// A team's avatar. v1 ships only `color` (hex, validated at the editor like
// spinner colors); `imageId` is reserved for the future themed avatar set -
// when present it wins over color, and color stays the fallback so an old
// client that doesn't know `imageId` keeps rendering the swatch. Plain
// strings for forward compat.
export const AgentTeamAvatarSchema = z
  .object({
    color: z.string().min(1).optional(),
    imageId: z.string().min(1).optional(),
  })
  .passthrough();

// A named, per-host grouping of agent personalities that acts as an operating
// template: which personalities are on deck, plus a shared team prompt stacked
// directly ahead of the member's personality prompt at spawn. `id` is the
// stable identity everything binds to; `name` is a freely-renamable label.
// `memberIds` bind personality ids (order = display order) - an entry pointing
// at a deleted personality is tolerated and ignored everywhere, then pruned on
// the next save of that team. Membership is many-to-many.
export const AgentTeamSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    avatar: AgentTeamAvatarSchema.optional(),
    teamPrompt: z.string().optional(),
    memberIds: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

export type AgentTeam = z.infer<typeof AgentTeamSchema>;
export type AgentTeamAvatar = z.infer<typeof AgentTeamAvatarSchema>;

export const AgentPersonalitiesGetStatsRequestSchema = z.object({
  type: z.literal("agentPersonalities.get_stats.request"),
  requestId: z.string(),
});

// COMPAT(personalityProfile): added in v0.7.5; gate lives in
// features.personalityProfile. Author a personality PROFILE (the prose
// `personalityPrompt` that shapes how an agent behaves) from the only things
// the editor knows before one exists: the handle, the roles it will be spawned
// for, and its two spinner colors. Like the voice-cue RPC this is described
// inline (not a stored id) so the editor can generate for an unsaved draft, and
// is an editor-time action: the result lands in the prompt field for the user to
// edit, and is stored on the personality by the ordinary save.
export const AgentPersonalitiesGenerateProfileRequestSchema = z.object({
  type: z.literal("agentPersonalities.generate_profile.request"),
  requestId: z.string(),
  name: z.string(),
  // Permissive strings to match the stored personality shape (forward-compatible
  // with roles this daemon predates); the daemon filters to its known set.
  roles: z.array(z.string().min(1)).optional(),
  // The spinner glow pair, read as a palette (temperature, energy) and never
  // quoted literally in the profile.
  glowA: z.string().optional(),
  glowB: z.string().optional(),
  // Scopes provider resolution to a workspace; omitted falls back to any
  // resolvable one.
  cwd: z.string().optional(),
});

export const AgentPersonalitiesGetStatsResponseSchema = z.object({
  type: z.literal("agentPersonalities.get_stats.response"),
  payload: z
    .object({
      requestId: z.string(),
      // Per-personality spawn counts, keyed by personality id.
      stats: z.record(z.string(), z.number()),
    })
    .passthrough(),
});

export const AgentPersonalitiesGenerateProfileResponseSchema = z.object({
  type: z.literal("agentPersonalities.generate_profile.response"),
  payload: z
    .object({
      requestId: z.string(),
      // The authored personality prompt, ready to drop into the editor's prompt
      // field. Absent when generation failed (see error) or no writer/provider
      // resolves on this host.
      profile: z.string().optional(),
      error: z.string().optional(),
    })
    .passthrough(),
});

export type AgentPersonalitiesGenerateProfileResult = z.infer<
  typeof AgentPersonalitiesGenerateProfileResponseSchema
>["payload"];

// The Visualizer lifecycle moments a personality voice-cue line can belong to.
// Protocol owns this vocabulary - the daemon's cue generator, the personality
// editor, and the Visualizer playback hook all import it from here.
// "waiting" is the parent's turn ending while its observed sub-agents are still
// running; it DEFERS "done" rather than replacing it (see docs/visualizer.md).
export const CUE_MOMENTS = ["join", "thinking", "waiting", "done"] as const;
export type CueMoment = (typeof CUE_MOMENTS)[number];

// Two glow colors for the personality's thinking spinner (BlobLoader glowA/glowB).
export const AgentPersonalitySpinnerSchema = z
  .object({
    glowA: z.string().min(1),
    glowB: z.string().min(1),
  })
  .passthrough();

// A TTS voice for the personality's spoken identity. Stored self-describing -
// provider + model + voice name - because voice names are namespaced per TTS
// engine/model (the same speaker index maps to different names across models),
// so a bare name is ambiguous across hosts. All plain strings (like the speech
// config) for forward-compat. This is a soft binding: an unavailable voice
// degrades to the host default at playback time, it never takes the personality
// out of commission.
export const AgentPersonalityVoiceSchema = z
  .object({
    provider: z.string().min(1),
    model: z.string().min(1),
    name: z.string().min(1),
  })
  .passthrough();

// Pre-generated (and user-editable) spoken "voice cue" lines for the personality
// - a few short variations for each Visualizer moment (its node joins the graph,
// first starts thinking, finishes its turn but waits on sub-agents, completes).
// Stored on the personality so they're deterministic and hand-tunable in the
// editor; the Visualizer reads them directly (no runtime generation). All groups
// optional/loose - a personality may have none, or only some (personalities
// authored before "waiting" existed simply stay silent for that moment).
// See docs/visualizer.md "Voice cues".
export const AgentPersonalityVoiceCuesSchema = z
  .object({
    join: z.array(z.string()).optional(),
    thinking: z.array(z.string()).optional(),
    waiting: z.array(z.string()).optional(),
    done: z.array(z.string()).optional(),
  })
  .passthrough();

export type AgentPersonalityVoiceCues = z.infer<typeof AgentPersonalityVoiceCuesSchema>;

// A named, reusable agent template stored per-host. `id` is the stable identity
// everything binds to; `name` is a freely-renamable label. Effort and roles are
// plain strings on the wire (like speech engine/model ids) so the daemon can
// grow the vocabulary without breaking old peers; the daemon validates them
// against its own catalog when applying a patch.
export const AgentPersonalitySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /** A key into the client's icon registry, not a glyph. Unknown keys draw the default. */
    icon: z.string().optional(),
    /** An identity colour name shared with host badges. Unknown values draw unthemed. */
    color: z.string().optional(),
    provider: z.string().min(1),
    model: z.string().min(1),
    // Canonical effort level ("off".."max"); resolved to the bound model's
    // nearest advertised option at spawn.
    effortLevel: z.string().min(1).optional(),
    modeId: z.string().min(1).optional(),
    personalityPrompt: z.string().optional(),
    // Default true: the daemon-global appendSystemPrompt still stacks on top of
    // the personality prompt. False = the personality prompt stands alone.
    respectGlobalAppendPrompt: z.boolean().optional(),
    roles: z.array(z.string().min(1)).optional(),
    spinner: AgentPersonalitySpinnerSchema.optional(),
    voice: AgentPersonalityVoiceSchema.optional(),
    voiceCues: AgentPersonalityVoiceCuesSchema.optional(),
    // Whether this personality accrues lessons across sessions (personality
    // memory). ABSENT MEANS ON: a personality with no lessons injects nothing
    // and costs nothing, so an off-by-default switch would only mean the feature
    // never starts working for anyone who did not go looking for it. The switch
    // exists to stop a personality accruing, not to start it.
    // See docs/agent-personalities.md § Memory.
    memoryEnabled: z.boolean().optional(),
  })
  .passthrough();

export type AgentPersonality = z.infer<typeof AgentPersonalitySchema>;
export type AgentPersonalityVoice = z.infer<typeof AgentPersonalityVoiceSchema>;

// COMPAT(visualizerVoiceCues): added in v0.6.3; gate lives in
// features.visualizerVoiceCues. Author short spoken "cue" lines for a
// personality - a handful of variations each for three Visualizer moments
// (join / thinking / done) - via the Writer mini-task chain, flavored by the
// persona's `name` + `prompt`. The persona is passed inline (not a stored id)
// so the personality editor can generate for an unsaved draft too; the result
// is stored on the personality (`voiceCues`) and edited there, so this is an
// editor-time action, not a runtime one. `cwd` scopes provider resolution to a
// workspace; omitted falls back to any resolvable one.
export const VisualizerVoiceCuesGenerateRequestSchema = z.object({
  type: z.literal("visualizer.voiceCues.generate.request"),
  requestId: z.string(),
  name: z.string(),
  prompt: z.string().optional(),
  cwd: z.string().optional(),
  // The persona's roles (e.g. "researcher", "coder") so the writer can flavor
  // the lines to what the agent does. Permissive strings to match the stored
  // personality shape (forward-compatible with roles this daemon predates).
  roles: z.array(z.string().min(1)).optional(),
  // When present, author only this one moment's lines (a focused single-moment
  // prompt) and return only that group. The editor issues one request per
  // moment so it can show generation progress and keep the moments distinct.
  // Omitted → author all three at once (the original all-in-one path, still
  // used by older clients).
  moment: z.enum(CUE_MOMENTS).optional(),
});

export const VisualizerVoiceCuesGenerateResponseSchema = z.object({
  type: z.literal("visualizer.voiceCues.generate.response"),
  payload: z
    .object({
      requestId: z.string(),
      // Absent when generation failed (see error) or no writer/provider
      // resolves on this host. Reuses the stored-cues shape.
      cues: AgentPersonalityVoiceCuesSchema.optional(),
      error: z.string().optional(),
    })
    .passthrough(),
});

export type VisualizerVoiceCuesResult = z.infer<
  typeof VisualizerVoiceCuesGenerateResponseSchema
>["payload"];

// ─── Profile-named RPC twins ──────────────────────────────────────────────────
//
// COMPAT(agentProfileRpcs): added in v0.8.13, drop the legacy halves when the
// daemon floor >= v0.8.13.
//
// The stored template converged on Paseo's `AgentProfile`, so the wire follows.
// These are the same messages under conforming names (see docs/rpc-namespacing.md,
// which three of the legacy names violate). Derived with `.omit().extend()`
// rather than copied so the two halves cannot drift.
//
// The daemon ACCEPTS both halves from today. The client keeps EMITTING the
// legacy literals until the floor rises: a new client must not break against an
// old daemon, and the feature contract forbids writing a degraded fallback path.
//
// One name is not a straight translation. `agentPersonalities.generate_profile`
// generates a personality PROMPT, not a profile - a genuine trap once "profile"
// means the stored template - so its twin is named `generate_prompt`.

export const ProfileMemoryListRequestMessageSchema = PersonalityMemoryListRequestMessageSchema.omit(
  {
    type: true,
  },
).extend({ type: z.literal("profile.memory.list.request") });

export const ProfileMemoryListResponseMessageSchema =
  PersonalityMemoryListResponseMessageSchema.omit({ type: true }).extend({
    type: z.literal("profile.memory.list.response"),
  });

export const ProfileMemoryUpdateRequestMessageSchema =
  PersonalityMemoryUpdateRequestMessageSchema.omit({ type: true }).extend({
    type: z.literal("profile.memory.update.request"),
  });

export const ProfileMemoryUpdateResponseMessageSchema =
  PersonalityMemoryUpdateResponseMessageSchema.omit({ type: true }).extend({
    type: z.literal("profile.memory.update.response"),
  });

export const ProfileMemoryTransferRequestMessageSchema =
  PersonalityMemoryTransferRequestMessageSchema.omit({ type: true }).extend({
    type: z.literal("profile.memory.transfer.request"),
  });

export const ProfileMemoryTransferResponseMessageSchema =
  PersonalityMemoryTransferResponseMessageSchema.omit({ type: true }).extend({
    type: z.literal("profile.memory.transfer.response"),
  });

export const ProfileMemoryStatsRequestMessageSchema =
  PersonalityMemoryStatsRequestMessageSchema.omit({ type: true }).extend({
    type: z.literal("profile.memory.stats.request"),
  });

export const ProfileMemoryStatsResponseMessageSchema =
  PersonalityMemoryStatsResponseMessageSchema.omit({ type: true }).extend({
    type: z.literal("profile.memory.stats.response"),
  });

export const AgentProfileStatsRequestSchema = AgentPersonalitiesGetStatsRequestSchema.omit({
  type: true,
}).extend({ type: z.literal("agent.profile.stats.request") });

export const AgentProfileStatsResponseSchema = AgentPersonalitiesGetStatsResponseSchema.omit({
  type: true,
}).extend({ type: z.literal("agent.profile.stats.response") });

export const AgentProfileGeneratePromptRequestSchema =
  AgentPersonalitiesGenerateProfileRequestSchema.omit({ type: true }).extend({
    type: z.literal("agent.profile.generate_prompt.request"),
  });

export const AgentProfileGeneratePromptResponseSchema =
  AgentPersonalitiesGenerateProfileResponseSchema.omit({ type: true }).extend({
    type: z.literal("agent.profile.generate_prompt.response"),
  });

export const AgentProfileGenerateVoiceCuesRequestSchema =
  VisualizerVoiceCuesGenerateRequestSchema.omit({ type: true }).extend({
    type: z.literal("agent.profile.generate_voice_cues.request"),
  });

export const AgentProfileGenerateVoiceCuesResponseSchema =
  VisualizerVoiceCuesGenerateResponseSchema.omit({ type: true }).extend({
    type: z.literal("agent.profile.generate_voice_cues.response"),
  });
