/** A fixed command transport vocabulary, never a client-supplied HTTP proxy. */
import { z } from "zod/v3";
import { ModelJobRequestSchema } from "../service/model-job-options.js";
import {
  RepoSchema,
  SelectionSchema,
  DirectSchema,
} from "../service/model-acquisition-contract.js";
import { CommandError } from "../output/types.js";
import { ReportExportOptionsSchema } from "./report-contract.js";
import { RescoreOptionsSchema } from "./rescore-contract.js";

const Id = z.string().min(1).max(1024);
const Runtime = z.object({ runtimeId: Id }).strict();
export const BrainCommandRequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("rescore"), body: RescoreOptionsSchema }).strict(),
  z.object({ operation: z.literal("report-export"), body: ReportExportOptionsSchema }).strict(),
  z.object({ operation: z.literal("capabilities") }).strict(),
  z.object({ operation: z.literal("inventory") }).strict(),
  z.object({ operation: z.literal("scan"), metadata: z.boolean() }).strict(),
  z.object({ operation: z.literal("catalog") }).strict(),
  z.object({ operation: z.literal("runtimes") }).strict(),
  z
    .object({
      operation: z.literal("search"),
      query: z.string().min(1).max(1024),
      limit: z.number().int().min(1).max(100),
    })
    .strict(),
  z.object({ operation: z.literal("quants"), repo: RepoSchema }).strict(),
  z.object({ operation: z.literal("job-read"), id: Id }).strict(),
  z.object({ operation: z.literal("job-cancel"), body: z.object({ id: Id }).strict() }).strict(),
  z.object({ operation: z.literal("job-model"), body: ModelJobRequestSchema }).strict(),
  z.object({ operation: z.literal("job-pull"), body: SelectionSchema }).strict(),
  z.object({ operation: z.literal("job-add"), body: DirectSchema }).strict(),
  z
    .object({
      operation: z.literal("runtime-candidate"),
      body: z
        .object({
          build: z.string().regex(/^(?:latest|b[1-9]\d{0,8})$/u),
          variant: z.enum(["auto", "cuda", "metal", "vulkan", "cpu"]),
        })
        .strict(),
    })
    .strict(),
  z.object({ operation: z.literal("runtime-install"), body: Runtime }).strict(),
  z
    .object({
      operation: z.literal("runtime-select"),
      body: z.object({ runtimeId: Id.nullable() }).strict(),
    })
    .strict(),
  z.object({ operation: z.literal("runtime-remove"), body: Runtime }).strict(),
]);
export type BrainCommandRequest = z.infer<typeof BrainCommandRequestSchema>;

const GET = {
  capabilities: "/__host/capabilities",
  inventory: "/__host/models",
  catalog: "/__host/catalog",
  runtimes: "/__host/runtimes",
} as const;
const POST = {
  rescore: "/__host/jobs/rescore",
  "report-export": "/__host/reports/export",
  "job-cancel": "/__host/jobs/cancel",
  "job-model": "/__host/jobs",
  "job-pull": "/__host/jobs/pull",
  "job-add": "/__host/jobs/add",
  "runtime-candidate": "/__host/runtime/candidate",
  "runtime-install": "/__host/jobs/runtime-install",
  "runtime-select": "/__host/runtime/select",
  "runtime-remove": "/__host/runtime/remove",
} as const;
export function brainCommandHttpRequest(input: BrainCommandRequest): {
  route: string;
  body?: unknown;
} {
  const request = BrainCommandRequestSchema.parse(input);
  switch (request.operation) {
    case "capabilities":
    case "inventory":
    case "catalog":
    case "runtimes":
      return { route: GET[request.operation] };
    case "search":
      return {
        route: `/__host/hf/search?${new URLSearchParams({ query: request.query, limit: String(request.limit) })}`,
      };
    case "scan":
      return {
        route: `/__host/models/discover?${new URLSearchParams({ metadata: String(request.metadata) })}`,
      };
    case "quants":
      return { route: `/__host/hf/quants?${new URLSearchParams({ repo: request.repo })}` };
    case "job-read":
      return { route: `/__host/jobs/status?${new URLSearchParams({ id: request.id })}` };
    default:
      return { route: POST[request.operation], body: request.body };
  }
}

function invalid(): never {
  throw new CommandError({
    code: "UNSUPPORTED_COMMAND_REQUEST",
    message: "This operation is unavailable through the selected Brain command transport.",
  });
}
function query(url: URL, keys: string[]): void {
  const actual = [...url.searchParams.keys()];
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid();
}
function readRequest(url: URL): BrainCommandRequest {
  switch (url.pathname) {
    case "/__host/models/discover": {
      query(url, ["metadata"]);
      const metadata = url.searchParams.get("metadata");
      if (metadata !== "true" && metadata !== "false") invalid();
      return { operation: "scan", metadata: metadata === "true" };
    }
    case "/__host/hf/search":
      query(url, ["query", "limit"]);
      return BrainCommandRequestSchema.parse({
        operation: "search",
        query: url.searchParams.get("query"),
        limit: Number(url.searchParams.get("limit")),
      });
    case "/__host/hf/quants":
      query(url, ["repo"]);
      return BrainCommandRequestSchema.parse({
        operation: "quants",
        repo: url.searchParams.get("repo"),
      });
    case "/__host/jobs/status":
      query(url, ["id"]);
      return BrainCommandRequestSchema.parse({
        operation: "job-read",
        id: url.searchParams.get("id"),
      });
    default:
      invalid();
  }
}
/** Existing shared handlers use paths internally. Only this validated vocabulary crosses RPC. */
export function encodeBrainCommandRequest(route: string, body?: unknown): BrainCommandRequest {
  if (!route.startsWith("/__host/") || route.includes("#")) invalid();
  const url = new URL(route, "http://brain-command.invalid");
  if (body === undefined) {
    for (const [operation, path] of Object.entries(GET)) {
      if (route === path) return BrainCommandRequestSchema.parse({ operation });
    }
    return readRequest(url);
  }
  if (url.search) invalid();
  for (const [operation, path] of Object.entries(POST)) {
    if (route === path) return BrainCommandRequestSchema.parse({ operation, body });
  }
  return invalid();
}
