import type { GraphEngineSpawnInput } from "./graph-engine.js";
import type { RunEngineAwaitResult, OrchestrationLogger } from "./workflow-engine.js";
import type {
  WorkflowScope,
  WorkflowSeat,
  WorkflowEntry,
  WorkflowRef,
} from "@getpaseo/plugin/otto/workflows";

export interface WorkflowWorkspace {
  workspaceId: string;
  projectId: string;
  cwd: string;
}
export interface WorkflowAgentRequest {
  agentId: string;
  runId: string;
  ownerInstance: string;
  workspace: WorkflowWorkspace;
  parentAgentId?: string;
  seat: WorkflowSeat;
  title: string;
  role: "conductor" | "worker" | "judge";
  access: "read" | "none" | "write";
  outputFields?: GraphEngineSpawnInput["outputFields"];
  toolGroups?: string[];
  queryTools?: GraphEngineSpawnInput["queryTools"];
  autonomous?: boolean;
  delegationDepth?: number;
}
export interface WorkflowRuntimePorts {
  /** Canonical Paseo workspace/project lookup; paths never come from RPC callers. */
  workspace(scope: WorkflowScope, workspaceId: string): Promise<WorkflowWorkspace>;
  /** Validate exact model/mode and enforceable access before admission. Never start a session here. */
  validateSeat(
    seat: WorkflowSeat,
    workspace: WorkflowWorkspace,
    access: WorkflowAgentRequest["access"],
  ): Promise<string[]>;
  validateTools?(seat: WorkflowSeat, names: readonly string[]): Promise<string[]>;
  createAgent(request: WorkflowAgentRequest): Promise<void>;
  turn(agentId: string, text: string, signal: AbortSignal): Promise<RunEngineAwaitResult>;
  waitUntilIdle(agentId: string, signal: AbortSignal): Promise<void>;
  notice(agentId: string, text: string): Promise<void>;
  cancelAgent(agentId: string): Promise<void>;
  closeAgent(agentId: string): Promise<void>;
  /** True only for this durable run's labeled owner; never cancel an unrelated chat on restart. */
  ownsAgent(agentId: string, runId: string, ownerInstance: string): Promise<boolean>;
  /** Observe only lifecycle changes while runs exist, not transcript copies or polling. */
  observe(
    listener: (agentId: string, state: "archived" | "deleted" | "canceled") => void,
  ): () => void;
  now(): string;
  logger: OrchestrationLogger;
  changed?(entry: WorkflowEntry): void;
}
export interface WorkflowAgentBinding {
  ref: WorkflowRef;
  role: WorkflowAgentRequest["role"];
  request: WorkflowAgentRequest;
}
