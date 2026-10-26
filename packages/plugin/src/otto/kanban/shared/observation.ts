import { z } from "zod";
import { defineRpc } from "../../../rpc.js";
import { ProjectBindingSchema, KanbanErrorSchema } from "./model.js";

const leaseId = z.string().min(1).max(128);
const rejected = z.object({ ok: z.literal(false), error: KanbanErrorSchema });
export const waitBoardChanges = defineRpc({
  name: "kanban.board.changes.wait.request",
  input: z
    .object({
      binding: ProjectBindingSchema.strict(),
      leaseId,
      cursor: z.string().min(1).max(128).nullable(),
    })
    .strict(),
  output: z.discriminatedUnion("ok", [
    rejected,
    z.object({ ok: z.literal(true), value: z.object({ cursor: z.string() }) }),
  ]),
});
export const releaseBoardChanges = defineRpc({
  name: "kanban.board.changes.release.request",
  input: z.object({ leaseId }).strict(),
  output: z.discriminatedUnion("ok", [
    rejected,
    z.object({ ok: z.literal(true), value: z.object({ released: z.literal(true) }) }),
  ]),
});
