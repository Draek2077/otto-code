import { z } from "zod";
export const PageSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const option = z.object({ id: z.string(), name: z.string() });
export const FieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  dataType: z.string(),
  __typename: z.string(),
  options: z.array(option).optional(),
  multiSelectOptions: z.array(option).optional(),
  configuration: z
    .object({
      iterations: z.array(z.object({ id: z.string(), title: z.string() })),
      completedIterations: z.array(z.object({ id: z.string(), title: z.string() })),
    })
    .optional(),
});
export type GitHubField = z.infer<typeof FieldSchema>;
export const FieldPageSchema = z.object({
  node: z
    .object({
      id: z.string(),
      updatedAt: z.string(),
      viewerCanUpdate: z.boolean(),
      fields: z.object({ nodes: z.array(FieldSchema).max(100), pageInfo: PageSchema }),
    })
    .nullable(),
});
const people = z.object({
  nodes: z.array(z.object({ id: z.string(), login: z.string() })).max(100),
  pageInfo: PageSchema,
});
const labels = z.object({ nodes: z.array(option).max(100), pageInfo: PageSchema });
const content = { id: z.string(), title: z.string(), body: z.string(), assignees: people };
const repoContent = {
  ...content,
  viewerCanUpdate: z.boolean(),
  updatedAt: z.string(),
  repository: z.object({ id: z.string(), nameWithOwner: z.string() }),
  labels,
};
const ContentSchema = z.discriminatedUnion("__typename", [
  z.object({ __typename: z.literal("DraftIssue"), ...content }),
  z.object({ __typename: z.literal("Issue"), ...repoContent }),
  z.object({ __typename: z.literal("PullRequest"), ...repoContent }),
]);
export const ValueSchema = z.object({
  __typename: z.string(),
  field: z.object({ id: z.string() }).optional(),
  text: z.string().nullable().optional(),
  number: z.number().nullable().optional(),
  date: z.string().nullable().optional(),
  optionId: z.string().nullable().optional(),
  options: z.array(option).nullable().optional(),
  iterationId: z.string().nullable().optional(),
});
export type GitHubValue = z.infer<typeof ValueSchema>;
export const CardPageSchema = z.object({
  node: z
    .object({
      id: z.string(),
      updatedAt: z.string(),
      project: z.object({ id: z.string() }),
      content: ContentSchema.nullable(),
      fieldValues: z.object({ nodes: z.array(ValueSchema).max(100), pageInfo: PageSchema }),
    })
    .nullable(),
});
export type GitHubContent = z.infer<typeof ContentSchema>;
export const ChoicesPageSchema = z.object({
  repository: z.object({ id: z.string(), assignableUsers: people, labels }).nullable(),
});
export interface RepoChoices {
  people: { id: string; label: string }[];
  labels: { id: string; label: string }[];
}
