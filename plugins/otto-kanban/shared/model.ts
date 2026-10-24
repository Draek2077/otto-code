import { z } from "zod";

export const ProjectBindingSchema = z.object({
  hostId: z.string().min(1),
  projectId: z.string().min(1),
});
export type ProjectBinding = z.infer<typeof ProjectBindingSchema>;

// This is the existing project-record identity, not plugin-global settings.
export const ProjectTargetSchema = z
  .object({
    adapter: z.enum(["github", "jira"]),
    boardId: z.string().nullable().optional(),
    boardOwner: z.string().nullable().optional(),
  })
  .passthrough();
export type ProjectTarget = z.infer<typeof ProjectTargetSchema>;

export interface ProjectConfiguration {
  binding: ProjectBinding;
  settingsRevision: string;
  target: ProjectTarget | null;
}

export const KanbanErrorSchema = z.object({
  code: z.enum([
    "invalid_target",
    "invalid_settings",
    "revision_conflict",
    "wrong_host",
    "project_not_found",
    "auth_required",
    "scope_required",
    "not_found",
    "unsupported",
    "rate_limited",
    "unavailable",
    "invalid_response",
    "read_limit",
    "access_denied",
  ]),
  message: z.string(),
});
export type KanbanError = z.infer<typeof KanbanErrorSchema>;
export type Result<T> = { ok: true; value: T } | { ok: false; error: KanbanError };

export function failure(code: KanbanError["code"], message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

export const BoardSchema = z.object({
  provider: z.string(),
  id: z.string(),
  title: z.string(),
  url: z.string().nullable(),
  // A provider change marker, never a promise of a transactionally consistent read.
  revision: z.string(),
  capabilities: z.object({
    read: z.boolean(),
    create: z.boolean(),
    link: z.boolean(),
    move: z.boolean(),
    edit: z.boolean(),
    remove: z.boolean(),
  }),
  columns: z.array(z.object({ id: z.string(), title: z.string() })),
  cards: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      url: z.string().nullable(),
      columnId: z.string(),
      kind: z.string(),
      assignees: z.array(z.string()),
      archived: z.boolean(),
    }),
  ),
});
export type Board = z.infer<typeof BoardSchema>;

export type BoardRead =
  | { status: "unconfigured"; binding: ProjectBinding; settingsRevision: string }
  | { status: "ready"; binding: ProjectBinding; settingsRevision: string; board: Board }
  | { status: "error"; binding: ProjectBinding; error: KanbanError };
