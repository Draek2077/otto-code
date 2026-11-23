import type { BrainAction, BrainQuery } from "@getpaseo/protocol/otto/brain";

export interface BrainManagementRequest {
  route: string;
  body?: unknown;
}
const idQuery = (id: string) => `?id=${encodeURIComponent(id)}`;
const READS = {
  status: "status",
  inventory: "models",
  catalog: "catalog",
  runtimes: "runtimes",
  jobs: "jobs",
  resources: "resources",
  evals: "evals",
} as const;

/** No caller-controlled URL, destination or filesystem path crosses this boundary. */
export function brainQueryRequest(query: BrainQuery): BrainManagementRequest {
  switch (query.resource) {
    case "profile":
      return { route: `/__host/model/profile${idQuery(query.modelId)}` };
    case "delete-plan":
      return { route: `/__host/model/delete-plan${idQuery(query.modelId)}` };
    case "search":
      return {
        route: `/__host/hf/search?query=${encodeURIComponent(query.query)}&limit=${query.limit}`,
      };
    case "quants":
      return { route: `/__host/hf/quants?repo=${encodeURIComponent(query.repo)}` };
    default:
      return { route: `/__host/${READS[query.resource]}` };
  }
}
function modelAction(action: Extract<BrainAction, { modelId: string }>): BrainManagementRequest {
  const suffix = idQuery(action.modelId);
  switch (action.action) {
    case "load":
    case "unload":
      return { route: `/__host/model/${action.action}${suffix}`, body: {} };
    case "delete":
      return { route: `/__host/model/delete${suffix}`, body: {} };
    case "reset-name":
      return { route: `/__host/model/rename/reset${suffix}`, body: {} };
    case "rename":
      return { route: `/__host/model/rename${suffix}`, body: { displayName: action.displayName } };
    case "delete-component":
      return {
        route: `/__host/model/component/delete${suffix}`,
        body: { componentId: action.componentId },
      };
    case "save-profile":
      return {
        route: `/__host/model/profile${suffix}`,
        body: { patch: action.patch, expectedRevision: action.expectedRevision },
      };
    case "budget":
      return { route: `/__host/model/budget${suffix}`, body: { patch: action.patch } };
    case "job":
      return {
        route: "/__host/jobs",
        body: { operation: action.operation, modelId: action.modelId },
      };
    case "pull":
      return {
        route: "/__host/jobs/pull",
        body: { modelId: action.modelId, quant: action.quant, components: action.components },
      };
  }
}
export function brainActionRequest(action: BrainAction): BrainManagementRequest {
  if ("modelId" in action) return modelAction(action);
  switch (action.action) {
    case "scan":
      return { route: "/__host/models/scan", body: {} };
    case "cancel-job":
      return { route: "/__host/jobs/cancel", body: { id: action.jobId } };
    case "runtime-candidate":
      return { route: "/__host/runtime/candidate", body: { build: action.build } };
    case "install-runtime":
      return { route: "/__host/jobs/runtime-install", body: { runtimeId: action.runtimeId } };
    case "select-runtime":
      return { route: "/__host/runtime/select", body: { runtimeId: action.runtimeId } };
    case "remove-runtime":
      return { route: "/__host/runtime/remove", body: { runtimeId: action.runtimeId } };
    case "add":
      return {
        route: "/__host/jobs/add",
        body: { repo: action.repo, quant: action.quant, components: action.components },
      };
  }
}
