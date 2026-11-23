import { z } from "zod";

// The same wire identities and result shape as Otto 0.9.35.
const queryRequest = z.object({
  type: z.literal("search.chats.query.request"),
  requestId: z.string(),
  query: z.string().max(1000),
  workspaceId: z.string().optional(),
  projectId: z.string().optional(),
  archive: z.enum(["all", "active", "archived"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
const resolveRequest = z.object({
  type: z.literal("search.chats.resolve.request"),
  requestId: z.string(),
  agentId: z.string(),
  messageKey: z.string(),
});
const hit = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string().optional(),
  workspaceId: z.string().nullable(),
  projectId: z.string().nullable(),
  projectName: z.string(),
  archived: z.boolean(),
  messageKey: z.string(),
  role: z.enum(["user", "assistant"]),
  timestamp: z.string(),
  snippet: z.string(),
});
const queryResponse = z.object({
  type: z.literal("search.chats.query.response"),
  payload: z.object({
    requestId: z.string(),
    hits: z.array(hit),
    hasMore: z.boolean(),
    coverage: z.object({
      total: z.number(),
      indexed: z.number(),
      pending: z.number(),
      unavailable: z.number(),
    }),
  }),
});
const resolveResponse = z.object({
  type: z.literal("search.chats.resolve.response"),
  payload: z.object({
    requestId: z.string(),
    agentId: z.string(),
    workspaceId: z.string().nullable(),
    target: z.object({ epoch: z.string(), seq: z.number() }).nullable(),
  }),
});

export const chatSearchRequests = [queryRequest, resolveRequest] as const;
export const chatSearchResponses = [queryResponse, resolveResponse] as const;
