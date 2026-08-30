import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import {
  OrchestrationGraphSchema,
  reviewOrchestrationGraph,
  validateGraphDocument,
  validateOrchestrationGraph,
  type OrchestrationGraph,
  type WorkflowGraphExport,
  type WorkflowGraphImportResult,
} from "@otto-code/protocol/orchestration";
import type {
  CommandError,
  CommandDiagnostic,
  CommandOptions,
  ListResult,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { connectToDaemon, getDaemonHost } from "../../utils/client.js";

export interface WorkflowGraphCommandOptions extends CommandOptions {}

export interface WorkflowGraphRunOptions extends WorkflowGraphCommandOptions {
  cwd?: string;
  workspace?: string;
  title?: string;
  description?: string;
  input?: string[];
  orchestratorProfile?: string;
  orchestratorProvider?: string;
  orchestratorModel?: string;
  orchestratorThinking?: string;
}

interface WorkflowGraphClient {
  listOrchestrationGraphs(): Promise<OrchestrationGraph[]>;
  fetchWorkspaces(options?: { page?: { limit: number; cursor?: string } }): Promise<{
    entries: Array<{ id: string; workspaceDirectory: string }>;
    pageInfo: { nextCursor?: string | null };
  }>;
  startWorkflow(input: {
    flavor: "graph";
    cwd: string;
    workspaceId?: string;
    title?: string;
    description?: string;
    orchestratorPersonalityId?: string;
    orchestratorProvider?: string;
    orchestratorModel?: string;
    orchestratorThinkingOptionId?: string;
    graphId: string;
    graphInputs: Record<string, string>;
  }): Promise<{ runId?: string; agentId?: string; workspaceId?: string }>;
  exportWorkflowGraph(graphId: string): Promise<WorkflowGraphExport>;
  importWorkflowGraph(input: {
    cwd: string;
    export: WorkflowGraphExport;
    confirmed: boolean;
  }): Promise<WorkflowGraphImportResult>;
  close(): Promise<void>;
}

export interface WorkflowGraphRow {
  id: string;
  name: string;
  description: string | null;
  nodes: number;
  edges: number;
  updatedAt: string | null;
}

export const workflowGraphSchema: OutputSchema<WorkflowGraphRow> = {
  idField: "id",
  columns: [
    { header: "ID", field: "id", width: 24 },
    { header: "NAME", field: "name", width: 28 },
    { header: "NODES", field: "nodes", width: 7, align: "right" },
    { header: "EDGES", field: "edges", width: 7, align: "right" },
    { header: "UPDATED", field: "updatedAt", width: 24 },
  ],
};

export interface WorkflowGraphInspectRow {
  key: string;
  value: string;
}

export interface WorkflowGraphValidationResult {
  file: string;
  valid: true;
  scope: "structural";
  warnings: string[];
  diagnostics: CommandDiagnostic[];
  nodes: number;
  edges: number;
}

export interface WorkflowGraphRunResult {
  runId: string;
  graphId: string;
  agentId: string | null;
  workspaceId: string | null;
}

export interface WorkflowGraphExportResult {
  graphId: string;
  output: string;
  source: string;
  contentHash: string;
}

export interface WorkflowGraphImportCommandResult {
  status: string;
  graphId: string | null;
  source: string | null;
  destination: string | null;
  remediation: string;
}

const graphValidationSchema: OutputSchema<WorkflowGraphValidationResult> = {
  idField: "file",
  columns: [
    { header: "FILE", field: "file", width: 48 },
    { header: "SCOPE", field: "scope", width: 12 },
    { header: "NODES", field: "nodes", width: 7, align: "right" },
    { header: "EDGES", field: "edges", width: 7, align: "right" },
    { header: "WARNINGS", field: (result) => result.warnings.length, width: 9, align: "right" },
  ],
};

const graphRunSchema: OutputSchema<WorkflowGraphRunResult> = {
  idField: "runId",
  columns: [
    { header: "RUN ID", field: "runId", width: 24 },
    { header: "GRAPH ID", field: "graphId", width: 24 },
    { header: "ORCHESTRATOR CHAT", field: "agentId", width: 24 },
    { header: "WORKSPACE", field: "workspaceId", width: 24 },
  ],
};

const graphExportSchema: OutputSchema<WorkflowGraphExportResult> = {
  idField: "graphId",
  columns: [
    { header: "GRAPH ID", field: "graphId", width: 24 },
    { header: "OUTPUT", field: "output", width: 48 },
    { header: "SOURCE", field: "source", width: 30 },
  ],
};

const graphImportSchema: OutputSchema<WorkflowGraphImportCommandResult> = {
  idField: "graphId",
  columns: [
    { header: "STATUS", field: "status", width: 18 },
    { header: "GRAPH ID", field: "graphId", width: 24 },
    { header: "DESTINATION", field: "destination", width: 32 },
    { header: "REMEDIATION", field: "remediation", width: 72 },
  ],
};

export async function runWorkflowGraphExportCommand(
  id: string,
  options: WorkflowGraphCommandOptions & { output?: string },
  _command: Command,
): Promise<SingleResult<WorkflowGraphExportResult>> {
  const graphId = id.trim();
  const output = options.output?.trim();
  if (!graphId)
    throw { code: "INVALID_GRAPH_ID", message: "Graph id cannot be empty" } satisfies CommandError;
  if (!output)
    throw {
      code: "MISSING_EXPORT_OUTPUT",
      message: "--output is required for Graph export",
    } satisfies CommandError;
  const client = await connectWorkflowGraphClient(options.host);
  try {
    const exported = await client.exportWorkflowGraph(graphId);
    const file = resolve(output);
    await writeFile(file, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
    return {
      type: "single",
      data: {
        graphId,
        output: file,
        source: exported.source.storeKey,
        contentHash: exported.contentHash,
      },
      schema: graphExportSchema,
    };
  } catch (error) {
    throw toWorkflowGraphCommandError("WORKFLOW_GRAPH_EXPORT_FAILED", "export Graph", error);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runWorkflowGraphImportCommand(
  file: string,
  options: WorkflowGraphCommandOptions & { cwd?: string; confirm?: boolean },
  _command: Command,
): Promise<SingleResult<WorkflowGraphImportCommandResult>> {
  const cwd = options.cwd?.trim();
  if (!cwd)
    throw {
      code: "MISSING_CWD",
      message: "--cwd is required to select the destination project store",
    } satisfies CommandError;
  const exported = await loadWorkflowGraphExportFile(file);
  const client = await connectWorkflowGraphClient(options.host);
  try {
    const result = await client.importWorkflowGraph({
      cwd,
      export: exported,
      confirmed: options.confirm === true,
    });
    return { type: "single", data: toGraphImportCommandResult(result), schema: graphImportSchema };
  } catch (error) {
    throw toWorkflowGraphCommandError("WORKFLOW_GRAPH_IMPORT_FAILED", "import Graph", error);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runWorkflowGraphListCommand(
  options: WorkflowGraphCommandOptions,
  _command: Command,
): Promise<ListResult<WorkflowGraphRow>> {
  const client = await connectWorkflowGraphClient(options.host);
  try {
    const graphs = await client.listOrchestrationGraphs();
    return { type: "list", data: graphs.map(toWorkflowGraphRow), schema: workflowGraphSchema };
  } catch (error) {
    throw toWorkflowGraphCommandError("WORKFLOW_GRAPH_LIST_FAILED", "list Graphs", error);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runWorkflowGraphInspectCommand(
  id: string,
  options: WorkflowGraphCommandOptions,
  _command: Command,
): Promise<ListResult<WorkflowGraphInspectRow>> {
  const client = await connectWorkflowGraphClient(options.host);
  try {
    const graph = await findWorkflowGraph(client, id);
    const rows = [
      { key: "Id", value: graph.id },
      { key: "Name", value: graph.name },
      { key: "Description", value: graph.description ?? "" },
      { key: "Nodes", value: String(graph.nodes.length) },
      { key: "Edges", value: String(graph.edges?.length ?? 0) },
      { key: "UpdatedAt", value: graph.updatedAt ?? "" },
    ];
    return {
      type: "list",
      data: rows,
      schema: {
        idField: "key",
        columns: [
          { header: "KEY", field: "key", width: 16 },
          { header: "VALUE", field: "value", width: 84 },
        ],
        serialize: () => graph,
      },
    };
  } catch (error) {
    throw toWorkflowGraphCommandError("WORKFLOW_GRAPH_INSPECT_FAILED", "inspect Graph", error);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runWorkflowGraphValidateCommand(
  file: string,
  _options: CommandOptions,
  _command: Command,
): Promise<SingleResult<WorkflowGraphValidationResult>> {
  const graph = await loadWorkflowGraphFile(file);
  const diagnostics = validateGraphDocument(graph);
  const problems = validateOrchestrationGraph(graph);
  if (problems.length > 0) {
    const documentErrors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    throw {
      code:
        documentErrors.length > 0
          ? "WORKFLOW_GRAPH_DOCUMENT_INVALID"
          : "WORKFLOW_GRAPH_NOT_STRUCTURALLY_VALID",
      message:
        documentErrors.length > 0
          ? `Graph ${resolve(file)} has an unsupported document format`
          : `Graph ${resolve(file)} is not structurally valid`,
      details: problems,
      diagnostics,
    } satisfies CommandError;
  }
  return {
    type: "single",
    data: {
      file: resolve(file),
      valid: true,
      scope: "structural",
      warnings: reviewOrchestrationGraph(graph),
      diagnostics,
      nodes: graph.nodes.length,
      edges: graph.edges?.length ?? 0,
    },
    schema: graphValidationSchema,
  };
}

export async function runWorkflowGraphRunCommand(
  id: string,
  options: WorkflowGraphRunOptions,
  _command: Command,
): Promise<SingleResult<WorkflowGraphRunResult>> {
  const input = parseWorkflowGraphRunInput(id, options);
  const client = await connectWorkflowGraphClient(options.host);
  try {
    const graph = await findWorkflowGraph(client, input.graphId);
    const graphInputs = resolveWorkflowGraphInputs(graph, input.graphInputs);
    const workspaceId = await resolveWorkflowGraphWorkspaceId(client, input);
    const started = await client.startWorkflow({
      flavor: "graph",
      cwd: input.cwd,
      workspaceId,
      ...(input.title ? { title: input.title } : {}),
      ...(input.description ? { description: input.description } : {}),
      ...(input.orchestratorProfile
        ? { orchestratorPersonalityId: input.orchestratorProfile }
        : {}),
      ...(input.orchestratorProvider ? { orchestratorProvider: input.orchestratorProvider } : {}),
      ...(input.orchestratorModel ? { orchestratorModel: input.orchestratorModel } : {}),
      ...(input.orchestratorThinking
        ? { orchestratorThinkingOptionId: input.orchestratorThinking }
        : {}),
      graphId: input.graphId,
      graphInputs,
    });
    if (!started.runId) {
      throw new Error("Daemon did not return a Workflow run ID.");
    }
    return {
      type: "single",
      data: {
        runId: started.runId,
        graphId: input.graphId,
        agentId: started.agentId ?? null,
        workspaceId: started.workspaceId ?? null,
      },
      schema: graphRunSchema,
    };
  } catch (error) {
    throw toWorkflowGraphCommandError("WORKFLOW_GRAPH_RUN_FAILED", "run Graph", error);
  } finally {
    await client.close().catch(() => {});
  }
}

export async function loadWorkflowGraphFile(file: string): Promise<OrchestrationGraph> {
  const resolved = resolve(file);
  let raw: string;
  try {
    raw = await readFile(resolved, "utf-8");
  } catch (error) {
    throw {
      code: "WORKFLOW_GRAPH_FILE_UNREADABLE",
      message: `Cannot read Graph file ${resolved}`,
      details: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw {
      code: "WORKFLOW_GRAPH_FILE_INVALID_JSON",
      message: `Graph file ${resolved} is not valid JSON`,
      details: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }

  const parsed = OrchestrationGraphSchema.safeParse(document);
  if (!parsed.success) {
    throw {
      code: "WORKFLOW_GRAPH_FILE_INVALID_SHAPE",
      message: `Graph file ${resolved} does not match the Graph document format`,
      details: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "document"}: ${issue.message}`,
      ),
    } satisfies CommandError;
  }
  return parsed.data;
}

export async function loadWorkflowGraphExportFile(file: string): Promise<WorkflowGraphExport> {
  const resolved = resolve(file);
  let raw: string;
  try {
    raw = await readFile(resolved, "utf-8");
  } catch (error) {
    throw {
      code: "WORKFLOW_GRAPH_EXPORT_UNREADABLE",
      message: `Cannot read Graph export ${resolved}`,
      details: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch (error) {
    throw {
      code: "WORKFLOW_GRAPH_EXPORT_INVALID_JSON",
      message: `Graph export ${resolved} is not valid JSON`,
      details: error instanceof Error ? error.message : String(error),
    } satisfies CommandError;
  }
  const { WorkflowGraphExportSchema } = await import("@otto-code/protocol/orchestration");
  const parsed = WorkflowGraphExportSchema.safeParse(document);
  if (!parsed.success)
    throw {
      code: "WORKFLOW_GRAPH_EXPORT_INVALID_SHAPE",
      message: `Graph export ${resolved} does not match the sharing format`,
      details: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    } satisfies CommandError;
  return parsed.data;
}

function toGraphImportCommandResult(
  result: WorkflowGraphImportResult,
): WorkflowGraphImportCommandResult {
  return {
    status: result.status,
    graphId: result.graph?.id ?? null,
    source: result.source?.storeKey ?? null,
    destination: result.destination?.storeKey ?? null,
    remediation: result.remediation,
  };
}

export function parseWorkflowGraphRunInput(
  id: string,
  options: WorkflowGraphRunOptions,
): {
  graphId: string;
  cwd: string;
  workspaceId?: string;
  title?: string;
  description?: string;
  graphInputs: Record<string, string>;
  orchestratorProfile?: string;
  orchestratorProvider?: string;
  orchestratorModel?: string;
  orchestratorThinking?: string;
} {
  const graphId = id.trim();
  if (!graphId) {
    throw { code: "INVALID_GRAPH_ID", message: "Graph id cannot be empty" } satisfies CommandError;
  }
  const cwdOption = options.cwd?.trim();
  if (options.host !== undefined && !cwdOption) {
    throw {
      code: "MISSING_CWD",
      message: "--cwd is required when --host is specified",
      details: "The local working directory may not exist on the remote daemon.",
    } satisfies CommandError;
  }
  const orchestratorProfile = trimOptional(options.orchestratorProfile);
  const orchestratorProvider = trimOptional(options.orchestratorProvider);
  const orchestratorModel = trimOptional(options.orchestratorModel);
  if (orchestratorProfile && (orchestratorProvider || orchestratorModel)) {
    throw {
      code: "CONFLICTING_ORCHESTRATOR_SEAT",
      message: "Use either --orchestrator-profile or --orchestrator-provider/--orchestrator-model",
    } satisfies CommandError;
  }
  if (orchestratorModel && !orchestratorProvider) {
    throw {
      code: "MISSING_ORCHESTRATOR_PROVIDER",
      message: "--orchestrator-model requires --orchestrator-provider",
    } satisfies CommandError;
  }
  return {
    graphId,
    cwd: cwdOption ?? process.cwd(),
    ...(trimOptional(options.workspace) ? { workspaceId: trimOptional(options.workspace) } : {}),
    ...(trimOptional(options.title) ? { title: trimOptional(options.title) } : {}),
    ...(trimOptional(options.description)
      ? { description: trimOptional(options.description) }
      : {}),
    graphInputs: parseGraphInputAssignments(options.input),
    ...(orchestratorProfile ? { orchestratorProfile } : {}),
    ...(orchestratorProvider ? { orchestratorProvider } : {}),
    ...(orchestratorModel ? { orchestratorModel } : {}),
    ...(trimOptional(options.orchestratorThinking)
      ? { orchestratorThinking: trimOptional(options.orchestratorThinking) }
      : {}),
  };
}

export function parseGraphInputAssignments(
  values: readonly string[] | undefined,
): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const value of values ?? []) {
    const separator = value.indexOf("=");
    const key = separator >= 0 ? value.slice(0, separator).trim() : "";
    if (!key) {
      throw {
        code: "INVALID_GRAPH_INPUT",
        message: `Graph input "${value}" must use key=value form`,
      } satisfies CommandError;
    }
    if (Object.hasOwn(inputs, key)) {
      throw {
        code: "DUPLICATE_GRAPH_INPUT",
        message: `Graph input "${key}" was supplied more than once`,
      } satisfies CommandError;
    }
    inputs[key] = value.slice(separator + 1);
  }
  return inputs;
}

export function resolveWorkflowGraphInputs(
  graph: OrchestrationGraph,
  supplied: Record<string, string>,
): Record<string, string> {
  const declared = new Map((graph.inputs ?? []).map((input) => [input.key, input]));
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key)) {
      throw {
        code: "UNKNOWN_GRAPH_INPUT",
        message: `Graph "${graph.name}" does not declare input "${key}"`,
      } satisfies CommandError;
    }
  }
  const resolved: Record<string, string> = {};
  for (const input of graph.inputs ?? []) {
    const value = (supplied[input.key] ?? input.defaultValue ?? "").trim();
    if (input.required && !value) {
      throw {
        code: "MISSING_GRAPH_INPUT",
        message: `Graph "${graph.name}" requires input "${input.key}"`,
      } satisfies CommandError;
    }
    if (value) {
      resolved[input.key] = value;
    }
  }
  return resolved;
}

async function connectWorkflowGraphClient(host: string | undefined): Promise<WorkflowGraphClient> {
  const resolvedHost = getDaemonHost({ host });
  try {
    return (await connectToDaemon({ host })) as unknown as WorkflowGraphClient;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw {
      code: "DAEMON_NOT_RUNNING",
      message: `Cannot connect to daemon at ${resolvedHost}: ${message}`,
      details: "Start the daemon with: otto daemon start",
    } satisfies CommandError;
  }
}

async function findWorkflowGraph(
  client: WorkflowGraphClient,
  id: string,
): Promise<OrchestrationGraph> {
  const graph = (await client.listOrchestrationGraphs()).find((candidate) => candidate.id === id);
  if (!graph) {
    throw { code: "GRAPH_NOT_FOUND", message: `Graph not found: ${id}` } satisfies CommandError;
  }
  return graph;
}

async function resolveWorkflowGraphWorkspaceId(
  client: WorkflowGraphClient,
  input: { cwd: string; workspaceId?: string },
): Promise<string> {
  if (input.workspaceId) {
    return input.workspaceId;
  }
  let cursor: string | undefined;
  do {
    const page = await client.fetchWorkspaces({
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    const workspace = page.entries.find((entry) => entry.workspaceDirectory === input.cwd);
    if (workspace) {
      return workspace.id;
    }
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  throw {
    code: "WORKFLOW_GRAPH_WORKSPACE_REQUIRED",
    message: `No workspace is registered for ${input.cwd}`,
    details: "Create or open the workspace first, or pass its ID with --workspace.",
  } satisfies CommandError;
}

function toWorkflowGraphRow(graph: OrchestrationGraph): WorkflowGraphRow {
  return {
    id: graph.id,
    name: graph.name,
    description: graph.description ?? null,
    nodes: graph.nodes.length,
    edges: graph.edges?.length ?? 0,
    updatedAt: graph.updatedAt ?? null,
  };
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function toWorkflowGraphCommandError(code: string, action: string, error: unknown): CommandError {
  if (error && typeof error === "object" && "code" in error) {
    return error as CommandError;
  }
  return {
    code,
    message: `Failed to ${action}: ${error instanceof Error ? error.message : String(error)}`,
  };
}
