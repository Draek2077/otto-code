import { z } from "zod";

import { AGENT_LIFECYCLE_STATUSES } from "./agent-lifecycle.js";

export const AgentStatusSchema = z.enum(AGENT_LIFECYCLE_STATUSES);

export const AgentDirectoryFilterSchema = z.object({
  labels: z.record(z.string(), z.string()).optional(),
  projectKeys: z.array(z.string()).optional(),
  statuses: z.array(AgentStatusSchema).optional(),
  includeArchived: z.boolean().optional(),
  requiresAttention: z.boolean().optional(),
  thinkingOptionId: z.string().nullable().optional(),
});

export const FetchAgentHistoryRequestMessageSchema = z.object({
  type: z.literal("fetch_agent_history_request"),
  requestId: z.string(),
  filter: AgentDirectoryFilterSchema.optional(),
  // A ranked free-text query over agent title, workspace name, branch, and
  // project name. Present only on history: agent subscriptions filter on
  // structure, not on relevance. Ranking replaces `sort` when it is set.
  search: z.string().optional(),
  sort: z
    .array(
      z.object({
        key: z.enum(["status_priority", "created_at", "updated_at", "title"]),
        direction: z.enum(["asc", "desc"]),
      }),
    )
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().max(200),
      cursor: z.string().min(1).optional(),
    })
    .optional(),
});
