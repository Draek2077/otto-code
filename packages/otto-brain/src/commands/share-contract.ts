/** Bounded sharing options, without returned or round-tripped stored secrets. */
import { z } from "zod/v3";
export const ShareOptionsSchema = z
  .object({
    on: z.boolean().optional(),
    off: z.boolean().optional(),
    bind: z.string().min(1).max(1024).optional(),
    access: z.string().max(32).optional(),
    key: z.string().max(16384).optional(),
    generate: z.boolean().optional(),
    allowConfig: z.boolean().optional(),
    https: z.string().max(32).optional(),
  })
  .strict();
export type ShareOptions = z.infer<typeof ShareOptionsSchema>;
export interface ShareStatus {
  shared: boolean;
  bind: string;
  access: "open" | "key" | "none";
  hasKey: boolean;
  key: string | null;
  https: string;
  allowRemoteConfig: boolean;
  requiresRestart?: boolean;
}
export const OwnerShareRequestSchema = z
  .object({
    ownerId: z.string().min(1).max(256),
    expectedRevision: z.string().min(1).max(256),
    options: ShareOptionsSchema,
  })
  .strict();
export function selectShareOptions(options: ShareOptions): ShareOptions {
  const { on, off, bind, access, key, generate, allowConfig, https } = options;
  return ShareOptionsSchema.parse({ on, off, bind, access, key, generate, allowConfig, https });
}
