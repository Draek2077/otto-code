import { z } from "zod";
import type { OfficeApi } from "./office-connector-api.js";

export interface GoogleConnectorTool {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  run(api: OfficeApi, input: unknown): Promise<unknown>;
}

export function tool<T extends z.ZodType>(
  name: string,
  description: string,
  inputSchema: T,
  run: (api: OfficeApi, input: z.output<T>) => Promise<unknown>,
): GoogleConnectorTool {
  return {
    name,
    description,
    inputSchema,
    run: (api, input) => run(api, inputSchema.parse(input)),
  };
}

export const id = z.string().min(1).max(1024);
export const page = {
  pageToken: z.string().max(8192).optional(),
  pageSize: z.number().int().min(1).max(100).default(25),
};
