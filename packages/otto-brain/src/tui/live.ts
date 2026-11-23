/** The same owner SSE snapshots drive the terminal; slot IDs come from actual rows. */
import { z } from "zod/v3";
import type { BrainTuiSnapshot, TuiResident } from "./host.js";
const Number = z.number().finite();
const Stage = z.enum(["processing", "thinking", "generating"]);
const State = z.enum(["stopped", "starting", "ready", "stopping", "failed"]);
export const BrainTuiLiveSchema = z.object({
  instanceId: z.string().min(1),
  version: z.string(),
  state: State,
  libraryRevision: Number,
  jobRevision: Number,
  capabilities: z.object({ writable: z.boolean(), tui: z.boolean().optional() }),
  telemetry: z.object({
    requests: Number,
    ok: Number,
    reasoningOnly: Number,
    truncated: Number,
    warning: z.string().nullable(),
  }),
  residents: z
    .array(
      z.object({
        residentId: z.string(),
        modelId: z.string().nullable(),
        model: z.string().nullable(),
        state: State,
        pid: Number.nullable().optional(),
        slots: z
          .object({
            idleSlots: z.array(Number).max(256),
            threads: z
              .array(z.object({ slot: Number, phase: z.enum(["prefill", "decode"]) }))
              .max(256),
          })
          .nullable(),
        inference: z.object({ slotStages: z.record(Stage).optional() }),
      }),
    )
    .max(16),
});
export type BrainTuiLive = z.infer<typeof BrainTuiLiveSchema>;

export function tuiResidents(live: BrainTuiLive): TuiResident[] {
  return live.residents.flatMap((resident) => {
    if (resident.modelId === null) return [];
    const slots = new Map<number, TuiResident["slots"][number]>();
    for (const slot of resident.slots?.idleSlots ?? []) slots.set(slot, { slot, phase: "idle" });
    for (const row of resident.slots?.threads ?? [])
      slots.set(row.slot, {
        slot: row.slot,
        phase:
          resident.inference.slotStages?.[String(row.slot)] ??
          (row.phase === "prefill" ? "processing" : "generating"),
      });
    return [
      {
        residentId: resident.residentId,
        modelId: resident.modelId,
        displayName: resident.model ?? resident.modelId,
        phase: resident.state,
        pid: resident.pid ?? null,
        slots: [...slots.values()],
      },
    ];
  });
}
export function applyTuiLive(snapshot: BrainTuiSnapshot, live: BrainTuiLive): BrainTuiSnapshot {
  return {
    ...snapshot,
    instanceId: live.instanceId,
    version: live.version,
    state: live.state,
    telemetry: live.telemetry,
    residents: tuiResidents(live),
    connection: "connected",
    message: null,
  };
}
