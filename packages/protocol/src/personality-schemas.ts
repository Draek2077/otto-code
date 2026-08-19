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
