import type { BrainStateVisual } from "./state";

/** A slot id is local to one resident process, including across process restarts. */
export interface BrainSlotIdentity {
  modelId: string;
  residentId: string;
  slot: number;
}

export type BrainProxyStage = "processing" | "thinking" | "generating";

export interface BrainEngineSlotInput extends BrainSlotIdentity {
  phase: "idle" | "prefill" | "decode";
}

export interface BrainSlotInput extends BrainEngineSlotInput {
  stage: BrainProxyStage | null;
}

export interface BrainSlotStageInput extends BrainSlotIdentity {
  stage: BrainProxyStage;
}

/** Validated host projection. This is deliberately independent of transport schemas. */
export interface BrainStateInput {
  running?: boolean | null;
  reachable?: boolean | null;
  state?:
    | "unconfigured"
    | "unreachable"
    | "stopped"
    | "starting"
    | "ready"
    | "failed"
    | "stopping"
    | null;
  lastError?: string | null;
  queued?: number | null;
  slots?: {
    prefill?: number | null;
    decode?: number | null;
    threads?: readonly BrainSlotInput[] | null;
  } | null;
  /** Actual host reasoning evidence, never the presence of an open request. */
  reasoning?: boolean | null;
  activity?: { kind: string | null } | null;
}

/** Preserve the original renderer's semantic colors without changing shared themes. */
export type BrainPalette = Readonly<Record<BrainStateVisual["tone"], string>>;

function slotKey(identity: BrainSlotIdentity): string {
  return JSON.stringify([identity.modelId, identity.residentId, identity.slot]);
}

/** Join only observed engine rows, using the same process identity as the host. */
export function joinBrainSlotStages(
  threads: readonly BrainEngineSlotInput[],
  stages: readonly BrainSlotStageInput[],
): BrainSlotInput[] {
  const stagesBySlot = new Map(stages.map((row) => [slotKey(row), row.stage]));
  return threads.map((row) => ({ ...row, stage: stagesBySlot.get(slotKey(row)) ?? null }));
}
