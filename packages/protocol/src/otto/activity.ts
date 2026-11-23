import { z } from "zod";

export const activityPluginId = "otto-activity";
export const activityMethods = {
  summary: "stats.activity.get",
  log: "usage.log.get",
  reset: "stats.activity.reset",
} as const;

export const activityCounters = [
  "messagesSent",
  "messagesReceived",
  "tokensSent",
  "tokensReceived",
  "agentsCreated",
  "runsOrchestrated",
  "subagentsInvoked",
  "backgroundTasksInvoked",
  "thoughts",
  "toolsCalled",
  "artifactsCreated",
  "schedulesExecuted",
  "costMicroUsd",
  "mainChatTokensIn",
  "mainChatTokensOut",
  "mainChatCostMicroUsd",
  "generationsTokensIn",
  "generationsTokensOut",
  "generationsCostMicroUsd",
  "subagentTokensIn",
  "subagentTokensOut",
  "subagentCostMicroUsd",
  "compactionTokensIn",
  "compactionTokensOut",
  "claudeTokensIn",
  "claudeTokensOut",
] as const;
export type ActivityCounter = (typeof activityCounters)[number];
export const ActivityCountsSchema = z.record(z.string(), z.number());
export type ActivityCounts = z.infer<typeof ActivityCountsSchema>;
export const activityPeriods = [
  "today",
  "yesterday",
  "last7Days",
  "last30Days",
  "allTime",
] as const;
export type ActivityPeriod = (typeof activityPeriods)[number];
export const ActivitySummarySchema = z.record(z.enum(activityPeriods), ActivityCountsSchema);

const UsageCursorSchema = z.object({ at: z.number(), id: z.string().max(256) });
export const UsageLogRequestSchema = z.object({ before: UsageCursorSchema.optional() });
export const ActivityRequestSchema = z.object({}).strict();

export const UsageEventSchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.string(),
  subtype: z.string().optional(),
  provider: z.string(),
  model: z.string().optional(),
  tokensIn: z.number().default(0),
  cachedTokensIn: z.number().optional(),
  tokensOut: z.number().default(0),
  costMicroUsd: z.number().default(0),
  compactionTokensIn: z.number().optional(),
  compactionTokensOut: z.number().optional(),
  agentId: z.string().optional(),
  rounds: z.number().optional(),
  startedAt: z.number().optional(),
  subagentKey: z.string().optional(),
  parentSubagentKey: z.string().optional(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

export const UsageLogPageSchema = z.object({
  events: z.array(UsageEventSchema).max(100),
  next: UsageCursorSchema.nullable(),
});
