/** Bounded owner-side benchmark admission, shared with the standalone CLI. */
import { z } from "zod/v3";
import { CommandError } from "../output/types.js";
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

export const EndpointBenchmarkRequestSchema = z
  .object({
    endpoint: z.string().min(1).max(2048),
    options: BenchmarkOptionsSchema,
  })
  .strict();

/** Endpoint defaults are resolved only on the machine that will execute the suite. */
export function parseBenchmarkEndpoint(raw: string, defaultPort: number) {
  try {
    const source = raw.includes("://") ? raw : `http://${raw}`;
    const url = new URL(source);
    const authority = source.slice(source.indexOf("://") + 3).split(/[/?#]/, 1)[0]!;
    const explicitPort = /:(\d+)$/.exec(authority)?.[1];
    const port = Number(url.port || explicitPort || defaultPort);
    if (
      url.protocol !== "http:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error("Invalid endpoint");
    return { host: url.hostname.replace(/^\[|\]$/g, ""), port };
  } catch {
    throw new CommandError({
      code: "INVALID_ENDPOINT",
      message: "Supply an HTTP benchmark endpoint as host:port (IPv6 addresses use brackets).",
    });
  }
}
