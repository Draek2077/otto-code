import type { BrainSlotInput, BrainStateInput } from "../../input";
export interface BrainCapabilities {
  profiles: boolean;
  budget: boolean;
  logs: boolean;
  delete: boolean;
  load: boolean;
  resources: boolean;
  inventory: boolean;
  writable: boolean;
  jobs: boolean;
  restart: boolean;
}
export interface BrainLiveSlot extends BrainSlotInput {
  promptTokensPerSecond: number | null;
  tokensPerSecond: number | null;
  promptTokens: number | null;
  generatedTokens: number | null;
}
export interface BrainSlots {
  total: number | null;
  busy: number | null;
  prefill: number | null;
  decode: number | null;
  threads: BrainLiveSlot[];
}
export interface BrainInference {
  processing: number | null;
  thinking: number | null;
  generating: number | null;
}
export interface BrainGpu {
  name: string | null;
  driver: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  utilization: number | null;
  temperature: number | null;
}
export interface BrainResources {
  cpu: number | null;
  cpuCount: number | null;
  ramUsedBytes: number | null;
  ramTotalBytes: number | null;
  gpu: BrainGpu | null;
}
export interface BrainTelemetry {
  requests: number;
  ok: number;
  reasoningOnly: number;
  truncated: number;
  warning: string | null;
}
export interface BrainHostStatus extends BrainStateInput {
  running: boolean;
  pid: number | null;
  version: string | null;
  runtime: string | null;
  host: string | null;
  displayHost: string | null;
  port: number | null;
  secure: boolean;
  model: string | null;
  modelId: string | null;
  vramBytes: number | null;
  loadSeconds: number | null;
  startedAt: string | null;
  lastError: string | null;
  capabilities: BrainCapabilities;
  waitingModelIds: Record<string, number>;
  residents: { residentId: string; modelId: string; model: string | null; state: string }[];
  resources: BrainResources | null;
  telemetry: BrainTelemetry | null;
  slots: BrainSlots | null;
  inference: BrainInference | null;
}
export interface BrainLogs {
  lines: string[];
  total: number;
  state: string;
}
