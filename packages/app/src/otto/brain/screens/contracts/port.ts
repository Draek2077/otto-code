import type { BrainUiBridge } from "../../bridge";
import type { BrainHostStatus, BrainLogs } from "./host";
import type { BrainEvals } from "./benchmark";
import type {
  BrainBudgetPreview,
  BrainCatalogModel,
  BrainHfSearchResult,
  BrainInventory,
  BrainModelChoice,
  BrainJob,
  BrainProfilePatch,
  BrainProfileRead,
  BrainProfileSaved,
  BrainRepoQuant,
  BrainRuntime,
} from "./models";

export interface BrainView<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<void>;
}
export interface BrainScreenResources {
  status: BrainView<BrainHostStatus>;
  inventory: BrainView<BrainInventory>;
  catalog: BrainView<BrainCatalogModel[]>;
  modelNames: BrainView<BrainModelChoice[]>;
  runtimes: BrainView<BrainRuntime[]>;
  jobs: BrainView<BrainJob[]>;
  evals: BrainView<BrainEvals>;
  logs: BrainView<BrainLogs>;
}
export type BrainResourceKey = keyof BrainScreenResources;
export type BrainDemand = BrainResourceKey | "statusResources";
export interface BrainScreenHost {
  serverId: string;
  label: string;
  connected: boolean;
  connectionStatus: "connected" | "connecting" | "disconnected";
  mode: "local" | "remote";
  access: { manage: boolean; hfSearch: boolean; canElevateRuntimeRemoval: boolean };
}
export interface BrainScreenPreferences {
  /** Host-issued selection id. Local executable paths remain private to its adapter. */
  runtimeSelectionId: string | null;
  contentMaxWidth: number | null;
  outlinePadding: number;
}
export interface BrainScreenSnapshot extends BrainScreenResources {
  host: BrainScreenHost;
  preferences: BrainScreenPreferences;
  modelRevision: number;
}
export interface BrainPullInput {
  modelId: string;
  components?: string[];
  quant?: string;
  expectedBytes?: number;
}
export interface BrainAddInput {
  repo: string;
  quant: string;
  components?: string[];
  expectedBytes?: number;
}
export interface BrainScreenOperations {
  startHost: (modelId: string | null) => Promise<void>;
  stopHost: () => Promise<void>;
  restartHost: (modelId: string | null) => Promise<void>;
  installRuntime: (build: string | null) => Promise<BrainJob>;
  removeRuntime: (runtimeId: string) => Promise<BrainJob>;
  removeRuntimeElevated: (runtimeId: string) => Promise<void>;
  selectRuntime: (runtimeId: string | null) => Promise<void>;
  readInventory: () => Promise<BrainInventory>;
  searchModels: (query: string, limit: number) => Promise<BrainHfSearchResult[]>;
  readQuants: (repo: string) => Promise<BrainRepoQuant[]>;
  pullModel: (input: BrainPullInput) => Promise<BrainJob>;
  addModel: (input: BrainAddInput) => Promise<BrainJob>;
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: (modelId: string) => Promise<void>;
  renameModel: (modelId: string, displayName: string) => Promise<void>;
  resetModelName: (modelId: string) => Promise<void>;
  deleteModel: (modelId: string) => Promise<void>;
  deleteComponent: (modelId: string, componentId: string) => Promise<void>;
  readProfile: (modelId: string) => Promise<BrainProfileRead>;
  /** CAS against the revision that produced the UI draft. Reject a conflict without retrying it. */
  saveProfile: (
    modelId: string,
    patch: BrainProfilePatch,
    expectedRevision: string,
  ) => Promise<BrainProfileSaved>;
  previewBudget: (
    modelId: string,
    overrides: Record<string, string>,
  ) => Promise<BrainBudgetPreview>;
  calibrate: (modelId: string) => Promise<BrainJob>;
  sweep: (modelId: string) => Promise<BrainJob>;
  benchmark: (modelId: string | null) => Promise<BrainJob>;
  cancelJob: (jobId: string) => Promise<BrainJob[]>;
  /** Parent updates its canonical projections, including after successful mutations. */
  refresh: (resources: readonly BrainResourceKey[]) => Promise<void>;
  /** Synchronously publish the accepted job to this port's canonical snapshot. */
  observeJob: (job: BrainJob) => void;
  observeJobs: (jobs: BrainJob[]) => void;
  previewLifecycle: (input: { modelId: string; lifecycle: "loading" | "unloading" }) => void;
}
export interface BrainScreenPort {
  version: 1;
  ui: BrainUiBridge;
  getSnapshot: () => BrainScreenSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Parent coalesces these demands into the single host-owned status stream. */
  retain: (demand: BrainDemand) => () => void;
  operations: BrainScreenOperations;
}
