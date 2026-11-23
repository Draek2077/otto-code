export type BrainFieldValue = string | number | boolean | null;
export interface BrainProfile {
  [field: string]: BrainFieldValue | string[] | undefined;
  contextSize: number;
  cacheTypeK: string;
  cacheTypeV: string;
  flashAttention: boolean;
  gpuLayers: number;
  vision: boolean;
  enabledComponents?: string[];
  reasoningBudget: number;
  preserveReasoning?: boolean | null;
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  presencePenalty?: number;
  repeatPenalty?: number;
  parallelSlots: number;
  cachedChats: number;
  contextMultiplier: number;
  calibrationRequired: boolean;
  hostingProfileId: string | null;
  hostingProfileMode: "inherit" | "off" | "custom";
}
export interface BrainProfileField {
  key: string;
  label: string;
  kind: "number" | "toggle" | "cycle";
  description?: string | null;
  step?: number | null;
  min?: number | null;
  max?: number | null;
  precision?: number | null;
  options: (string | number)[];
  optionLabels: string[];
  optionValues?: BrainFieldValue[];
  available: boolean;
  unavailableReason?: string | null;
}
export interface BrainProfileWarning {
  field: string | null;
  severity: string;
  message: string;
  blocksStart: boolean;
}
export interface BrainCalibrationInfo {
  state: string;
  kvBytesPerToken: number | null;
  measuredAt: string | null;
  measuredOn: string | null;
}
export interface BrainBudget {
  weightsBytes: number;
  mmprojBytes: number;
  componentBytes?: number;
  drafterKvBytes?: number;
  imageProcessingBytes?: number;
  kvBytes: number;
  overheadBytes: number;
  totalBytes: number;
  usableBytes: number;
  totalVramBytes: number;
  reserveBytes: number;
  kvBytesPerToken: number;
  source: string;
  theoreticalKvBytesPerToken: number | null;
  fits: boolean;
  headroomBytes: number;
  utilization: number;
}
export type BrainTemplateValue =
  | BrainFieldValue
  | BrainTemplateValue[]
  | { [key: string]: BrainTemplateValue };
export interface BrainHostingProfile {
  id: string;
  name: string;
  family: string;
  description: string;
  template: string | null;
  systemPromptAddendum: string | null;
  templateKwargs: Record<string, BrainTemplateValue>;
}
export interface BrainModelComponent {
  id: string;
  label: string;
  description: string;
  role: string;
  bytes: number;
  available: boolean;
  unavailableReason?: string;
  required: boolean;
  defaultDownload: boolean;
  defaultLoad: boolean;
  minRuntimeBuild?: number;
}
export interface BrainInventoryModel {
  id: string;
  repo: string | null;
  catalogOwned: boolean;
  displayName: string;
  family?: string | null;
  publisher: string | null;
  quant: string | null;
  sizeBytes: number;
  mmprojBytes: number;
  origin: string | null;
  arch: string | null;
  contextLength: number | null;
  blockCount: number | null;
  headCountKv: number | null;
  hasProjector: boolean;
  components?: BrainModelComponent[] | null;
  reasoning: boolean;
  mtp: boolean;
  distilled: boolean;
  useCases: string[];
  tier: string | null;
  profile: BrainProfile | null;
  calibration: BrainCalibrationInfo | null;
  budget: BrainBudget | null;
  maxContextThatFits: number | null;
  score: {
    id: string | null;
    displayName: string;
    overall: number;
    runs: number;
    std: number;
    grade: string;
    rank?: number | null;
  } | null;
  state: string;
  warnings: BrainProfileWarning[];
}
export interface BrainCatalogComponent {
  id: string;
  label: string;
  description: string;
  role: string;
  file: string;
  hfRepo?: string;
  bytes?: number | null;
  required: boolean;
  defaultDownload: boolean;
  defaultLoad: boolean;
  minRuntimeBuild?: number;
}
export interface BrainCatalogModel {
  id: string;
  name: string;
  family?: string | null;
  favorite: boolean;
  installed: boolean;
  publisher: string;
  repo: string;
  quant: string;
  params: string;
  sizeBytes?: number | null;
  size: string;
  vision: boolean;
  thinking: boolean;
  contextMax?: number | null;
  tier: string;
  useCases: string[];
  why: string;
  components?: BrainCatalogComponent[];
}
export interface BrainRuntime {
  /** Opaque host-issued selection identity, never a client-side filesystem path. */
  id: string;
  label: string;
  displayName: string;
  version: string;
  source: string;
}
export interface BrainJob {
  id: string;
  kind: "pull" | "runtime-install" | "runtime-remove" | "calibrate" | "sweep" | "bench";
  label: string;
  modelId: string | null;
  catalogModelId: string | null;
  repo: string | null;
  quant: string | null;
  status: "running" | "succeeded" | "failed" | "canceled";
  queuePosition?: number | null;
  percent: number | null;
  message: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
export interface BrainHfSearchResult {
  repo: string;
  downloads: number;
  likes: number;
  gated: boolean;
  summary?: string | null;
  installed: boolean;
}
export interface BrainRepoQuant {
  quant: string;
  size: string;
  sizeBytes: number;
  files: number;
  fileNames?: string[];
  installed: boolean;
  modelId?: string | null;
  projector?: { file: string; sizeBytes: number; installed?: boolean };
}
export interface BrainInventory {
  models: BrainInventoryModel[];
  disk: { freeBytes: number; totalBytes: number; modelBytes: number } | null;
}
export interface BrainModelChoice {
  modelId: string;
  label: string;
}
export interface BrainProfileRead {
  /** Opaque revision of this model's normalized saved profile, issued by its host. */
  revision: string;
  profile: BrainProfile | null;
  fields: BrainProfileField[];
  warnings: BrainProfileWarning[];
  calibration: BrainCalibrationInfo | null;
  requiresRestart: boolean;
  hostingProfiles: BrainHostingProfile[];
  familyHostingProfileId: string | null;
}
export interface BrainProfileSaved extends BrainProfileRead {
  budget: BrainBudget | null;
  maxContextThatFits: number | null;
  adjustments: string[];
}
export interface BrainBudgetPreview {
  budget: BrainBudget | null;
  maxContextThatFits: number | null;
}
export interface BrainProfilePatch {
  [field: string]: BrainFieldValue | string[] | BrainHostingProfile | undefined;
  enabledComponents?: string[];
  hostingProfile?: BrainHostingProfile;
}
