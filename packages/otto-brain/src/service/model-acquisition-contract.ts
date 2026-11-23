/** Canonical bounded selections shared by the owner and its CLI transport. */
import { z } from "zod/v3";

export const RepoSchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/u);
export const SelectionSchema = z
  .object({
    modelId: z.string().min(1).max(1024),
    quant: z.string().min(1).max(128).optional(),
    file: z.string().min(1).max(1024).optional(),
    components: z.array(z.string().min(1).max(128)).max(32).optional(),
    componentsOnly: z.boolean().optional(),
  })
  .strict();
export const DirectSchema = z
  .object({
    repo: RepoSchema,
    quant: z.string().min(1).max(128),
    components: z.array(z.literal("vision-projector")).max(1).optional(),
    primaryOnly: z.boolean().optional(),
    componentsOnly: z.boolean().optional(),
  })
  .strict();
