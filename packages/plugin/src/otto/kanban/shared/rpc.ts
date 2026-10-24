import { defineRpc } from "../../../rpc.js";
import { z } from "zod";
import { BoardSchema, KanbanErrorSchema, ProjectBindingSchema } from "./model.js";

// These are typed plugin method names carried by Paseo's existing plugin RPC
// request/response envelope. No new WebSocket message or transport is defined.

// Project-record unknown fields stay on the daemon. The UI edits identifiers only.
export const BoardTargetInputSchema = z
  .object({
    adapter: z.enum(["github", "jira"]),
    boardId: z.string().nullable().optional(),
    boardOwner: z.string().nullable().optional(),
  })
  .strict();

const ErrorResultSchema = z.object({ ok: z.literal(false), error: KanbanErrorSchema });
export const ProjectConfigurationSchema = z.object({
  binding: ProjectBindingSchema,
  settingsRevision: z.string().min(1),
  target: BoardTargetInputSchema.nullable(),
});

export const getCapabilities = defineRpc({
  name: "kanban.get_capabilities",
  input: z.object({ hostId: z.string().min(1) }).strict(),
  output: z.discriminatedUnion("ok", [
    ErrorResultSchema,
    z.object({
      ok: z.literal(true),
      value: z.object({
        hostId: z.string(),
        contractVersion: z.literal(1),
        read: z.boolean(),
        configure: z.boolean(),
        providers: z.array(z.object({ id: z.string(), read: z.boolean(), mutate: z.boolean() })),
      }),
    }),
  ]),
});

export const getProjectConfiguration = defineRpc({
  name: "kanban.project.get_configuration",
  input: ProjectBindingSchema.strict(),
  output: z.discriminatedUnion("ok", [
    ErrorResultSchema,
    z.object({ ok: z.literal(true), value: ProjectConfigurationSchema }),
  ]),
});

export const setProjectTarget = defineRpc({
  name: "kanban.project.set_target",
  input: z
    .object({
      binding: ProjectBindingSchema.strict(),
      expectedRevision: z.string().min(1),
      target: BoardTargetInputSchema.nullable(),
    })
    .strict(),
  output: z.discriminatedUnion("ok", [
    ErrorResultSchema,
    z.object({ ok: z.literal(true), value: ProjectConfigurationSchema }),
  ]),
});

export const getBoard = defineRpc({
  name: "kanban.board.get",
  input: ProjectBindingSchema.strict(),
  output: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("unconfigured"),
      binding: ProjectBindingSchema,
      settingsRevision: z.string(),
    }),
    z.object({
      status: z.literal("ready"),
      binding: ProjectBindingSchema,
      settingsRevision: z.string(),
      board: BoardSchema,
    }),
    z.object({
      status: z.literal("error"),
      binding: ProjectBindingSchema,
      error: KanbanErrorSchema,
    }),
  ]),
});
