import { z } from "zod";
import { defineRpc } from "../../../rpc.js";
import { KanbanErrorSchema, ProjectBindingSchema } from "./model.js";

const id = z.string().min(1).max(512);
const choices = z.array(z.object({ id, label: z.string() })).max(100);
export const JiraCreateOptionsSchema = z.object({
  projects: choices,
  issueTypes: choices,
  revision: id.nullable(),
  available: z.boolean(),
  message: z.string().nullable(),
});
export type JiraCreateOptions = z.infer<typeof JiraCreateOptionsSchema>;
export const getJiraCreateOptions = defineRpc({
  name: "kanban.jira.creation.read.request",
  input: z
    .object({
      binding: ProjectBindingSchema.strict(),
      expectedSettingsRevision: id,
      expectedBoardRevision: id,
      projectId: id.optional(),
      issueTypeId: id.optional(),
    })
    .strict(),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), value: JiraCreateOptionsSchema }),
    z.object({ ok: z.literal(false), error: KanbanErrorSchema }),
  ]),
});
