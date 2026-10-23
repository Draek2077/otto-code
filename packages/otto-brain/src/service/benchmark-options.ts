/** Bounded owner-side benchmark admission, shared with the standalone CLI. */
import { z } from "zod/v3";
export const BenchmarkOptionsSchema = z
  .object({
    execute: z.boolean().optional(),
    depths: z.array(z.number().int().min(1).max(1048576)).min(1).max(16).optional(),
    only: z.array(z.string().min(1).max(128)).min(1).max(128).optional(),
    concurrency: z.number().int().min(1).max(64).optional(),
    repository: z
      .object({
        directory: z.string().min(1).max(4096),
        workspace: z.string().min(1).max(256),
        workspaceDirectory: z.string().min(1).max(1024),
        ref: z.string().min(1).max(1024),
        maxTasks: z.number().int().min(1).max(100),
      })
      .strict()
      .optional(),
  })
  .strict();
export type BenchmarkOptions = z.infer<typeof BenchmarkOptionsSchema>;
