import { z } from "zod";
const IdSchema = z.union([z.string().min(1), z.number().int().nonnegative()]);
export const JiraConfigurationSchema = z.object({
  id: IdSchema,
  name: z.string(),
  location: z.object({ id: IdSchema, type: z.string(), key: z.string().optional() }).optional(),
  columnConfig: z.object({
    columns: z
      .array(z.object({ name: z.string().min(1), statuses: z.array(z.object({ id: IdSchema })) }))
      .max(100),
  }),
});
export type JiraConfiguration = z.infer<typeof JiraConfigurationSchema>;
export const JiraIssueSchema = z.object({
  id: IdSchema,
  key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*-[1-9]\d*$/),
  fields: z
    .object({
      summary: z.string(),
      description: z.unknown().optional(),
      updated: z.union([z.string(), z.number()]),
      status: z.object({ id: IdSchema, name: z.string().optional() }),
      assignee: z
        .object({ accountId: z.string().optional(), displayName: z.string() })
        .nullable()
        .optional(),
      labels: z.array(z.string()).optional(),
      priority: z.object({ id: IdSchema, name: z.string() }).nullable().optional(),
      duedate: z.string().nullable().optional(),
      project: z.object({ id: IdSchema, key: z.string() }).optional(),
    })
    .passthrough(),
});
export type JiraIssue = z.infer<typeof JiraIssueSchema>;
export const JiraIssuePageSchema = z.object({
  issues: z.array(JiraIssueSchema).max(100),
  isLast: z.boolean(),
  nextPageToken: z.string().optional(),
});
