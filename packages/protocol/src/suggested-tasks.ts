import { z } from "zod";

/**
 * Otto suggested-task wire schemas: the tasks.suggested.* start and dismiss RPCs and the suggested-task payloads. Fork-only capability, so it owns its schemas; messages.ts re-exports them.
 */

// A suggested task an agent surfaced via the `spawn_task` tool (Claude Desktop
// parity). Renders as a chip in the parent agent's session; the user starts it
// (new worktree / local / this session) or dismisses it. The `prompt` is
// deliberately NOT part of this wire shape - it stays server-side and is only
// used when the task is started ("not shown directly" in Claude Desktop).
// COMPAT(suggestedTasks): added in v0.5.6, drop the gate when daemon floor >= v0.5.6.
export const SuggestedTaskStateSchema = z.enum(["pending", "started", "dismissed"]);

export const SuggestedTaskInfoSchema = z.object({
  taskId: z.string(),
  parentAgentId: z.string(),
  title: z.string(),
  tldr: z.string(),
  cwd: z.string().optional(),
  state: SuggestedTaskStateSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

// Pushed with the full current set of pending suggested tasks for a parent
// agent whenever any of them changes (spawn/start/dismiss) - same full-list
// reconciliation shape as BackgroundShellTasksChangedSchema.
export const SuggestedTasksChangedSchema = z.object({
  type: z.literal("suggested_tasks_changed"),
  payload: z.object({
    parentAgentId: z.string(),
    tasks: z.array(SuggestedTaskInfoSchema),
  }),
});

// Aggregate outcome for a start/dismiss over one or more tasks. `succeeded`/
// `failed` count the tasks acted on so the client can report "Started 3 tasks";
// `error` collects any per-task failure messages (the failed tasks' chips stay).
export const SuggestedTaskActionResponsePayloadSchema = z.object({
  requestId: z.string(),
  parentAgentId: z.string(),
  accepted: z.boolean(),
  succeeded: z.number(),
  failed: z.number(),
  error: z.string().nullable(),
});

// Start one or more suggested tasks, applying the SAME mode to each - no
// combining. Four modes, only `subagent` links the new agent to the parent:
//  - `new_chat`:   a fresh independent agent in its own tab, same repo/cwd, NO
//                  parent link - survives the parent's cancel/archive.
//  - `subagent`:   a bound child agent that shows in the parent's Subagents
//                  track and archive-cascades with it.
//  - `worktree`:   an independent agent on a new git worktree (auto branch-off),
//                  isolated workspace - also unlinked from the parent.
//  - `in_session`: steers the parent agent with the task prompt (no new agent).
// The daemon resolves the parent agent's brain (provider/model/personality) so a
// started task continues the suggesting agent.
export const TasksSuggestedStartModeSchema = z.enum([
  "new_chat",
  "subagent",
  "worktree",
  "in_session",
]);

export const TasksSuggestedStartRequestMessageSchema = z.object({
  type: z.literal("tasks.suggested.start.request"),
  parentAgentId: z.string(),
  taskIds: z.array(z.string()),
  mode: TasksSuggestedStartModeSchema,
  requestId: z.string(),
});

export const TasksSuggestedStartResponseMessageSchema = z.object({
  type: z.literal("tasks.suggested.start.response"),
  payload: SuggestedTaskActionResponsePayloadSchema,
});

export const TasksSuggestedDismissRequestMessageSchema = z.object({
  type: z.literal("tasks.suggested.dismiss.request"),
  parentAgentId: z.string(),
  taskIds: z.array(z.string()),
  requestId: z.string(),
});

export const TasksSuggestedDismissResponseMessageSchema = z.object({
  type: z.literal("tasks.suggested.dismiss.response"),
  payload: SuggestedTaskActionResponsePayloadSchema,
});

export type SuggestedTaskInfo = z.infer<typeof SuggestedTaskInfoSchema>;

export type SuggestedTaskState = z.infer<typeof SuggestedTaskStateSchema>;

export type SuggestedTasksChanged = z.infer<typeof SuggestedTasksChangedSchema>;

export type TasksSuggestedStartMode = z.infer<typeof TasksSuggestedStartModeSchema>;

export type TasksSuggestedStartResponseMessage = z.infer<
  typeof TasksSuggestedStartResponseMessageSchema
>;

export type TasksSuggestedDismissResponseMessage = z.infer<
  typeof TasksSuggestedDismissResponseMessageSchema
>;

export type TasksSuggestedStartRequestMessage = z.infer<
  typeof TasksSuggestedStartRequestMessageSchema
>;

export type TasksSuggestedDismissRequestMessage = z.infer<
  typeof TasksSuggestedDismissRequestMessageSchema
>;
