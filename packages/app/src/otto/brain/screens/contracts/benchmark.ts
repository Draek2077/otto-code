export interface RankedRow {
  id: string;
  name: string;
  overall: number;
  runs: number;
  /** Sample std across this model's runs; what says whether the rank is backed. */
  std: number | null;
  grade: string | null;
  rank: number;
}

export interface VarianceRow {
  key: string;
  modelId: string | null;
  /** Named to match `LatestRun` so both can be matched to a leaderboard row. */
  modelName: string;
  configKey: string | null;
  count: number;
  mean: number | null;
  std: number | null;
}

export interface RunTask {
  key: string;
  category: string;
  summary: string | null;
  weight: number | null;
  score: number | null;
  seconds: number | null;
  error: string | null;
}

export interface RunProfile {
  contextSize: number | null;
  cacheTypeK: string | null;
  cacheTypeV: string | null;
  reasoningBudget: number | null;
  vision: boolean | null;
  flashAttention: boolean | null;
  gpuLayers: number | null;
  parallelSlots: number | null;
  batchSize: number | null;
  ubatchSize: number | null;
  extraArgs: string[];
  /**
   * Schema 3+ profile fields. A record from before the profile-completeness
   * change simply did not store them - null means "not recorded", not "the
   * engine default", so the display omits the line rather than printing a
   * confident value.
   */
  preserveReasoning: boolean | null;
  contextMultiplier: number | null;
  cachedChats: number | null;
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  minP: number | null;
  presencePenalty: number | null;
  repeatPenalty: number | null;
  hostingProfileId: string | null;
}

export interface RunSetup {
  args: string[];
  adjusted: boolean;
  requestedContextSize: number | null;
  adjustReason: string | null;
  kvSource: string | null;
  kvInherited: boolean;
  kvBytesPerToken: number | null;
  theoreticalKvBytesPerToken: number | null;
  predictedVramBytes: number | null;
  headroomBytes: number | null;
}

export interface RunSuite {
  execute: boolean | null;
  concurrency: number | null;
  depths: number[] | null;
  only: string[] | null;
  mined: boolean;
}

export interface LatestRun {
  key: string;
  modelId: string | null;
  modelName: string;
  configKey: string | null;
  ranAt: string | null;
  overall: number | null;
  grade: string | null;
  seconds: number | null;
  executedCode: boolean | null;
  vramBytes: number | null;
  loadSeconds: number | null;
  runtime: string | null;
  gpuName: string | null;
  /** GGUF geometry: the ceiling a context size has to sit under to make sense. */
  nativeContextLength: number | null;
  blockCount: number | null;
  profile: RunProfile | null;
  setup: RunSetup | null;
  suite: RunSuite | null;
  tasks: RunTask[];
}

export interface BrainEvals {
  rankings: RankedRow[];
  variance: VarianceRow[];
  latest: LatestRun[];
  runCount: number;
}
