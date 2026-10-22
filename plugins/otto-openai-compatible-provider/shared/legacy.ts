import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const legacyStatus = defineRpc({
  name: "legacy.status",
  input: z.object({}),
  output: z.object({
    providers: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        enabled: z.boolean(),
        diagnostic: z.string().optional(),
      }),
    ),
    error: z.string().optional(),
  }),
});
