import type { BrainConnectionStateSnapshot } from "./connection-state";
import type { BrainHostStatus, BrainResources, BrainTelemetry } from "../screens/contracts/host";
import type { BrainStatus } from "@getpaseo/protocol/otto/brain";
import type { BrainScreenHost } from "../screens/contracts/port";

export function screenAccess(state: BrainConnectionStateSnapshot): BrainScreenHost["access"] {
  const flags = state.feed?.status?.capabilities;
  return {
    manage:
      state.connected && (state.connection?.config.mode === "local" || flags?.inventory === true),
    hfSearch: flags?.hfSearch === true,
    canElevateRuntimeRemoval: false,
  };
}

function capabilities(state: BrainConnectionStateSnapshot): BrainHostStatus["capabilities"] {
  const flags = state.feed?.status?.capabilities;
  return {
    profiles: Boolean(flags?.profiles),
    budget: Boolean(flags?.budget),
    logs: Boolean(flags?.logCursors),
    delete: Boolean(flags?.delete),
    load: Boolean(flags?.load),
    resources: Boolean(flags?.resources),
    inventory: Boolean(flags?.inventory),
    writable:
      state.feed?.connection === "connected" &&
      (state.connection?.config.mode === "local" || Boolean(flags?.writable)),
    jobs: Boolean(flags?.jobs),
    restart: state.connection?.config.mode === "local",
  };
}
function hostIdentity(state: BrainConnectionStateSnapshot) {
  return {
    pid: null,
    version: state.feed?.status?.version ?? null,
    runtime: state.owner?.resolved.runtimeLabel ?? null,
    host: state.endpoint,
    displayHost: state.endpoint,
    port: state.owner?.config.listen.port ?? null,
    secure: state.endpoint?.startsWith("https:") ?? false,
  };
}
function residentActivity(residents: BrainStatus["residents"]) {
  const threads = residents.flatMap((resident) =>
    (resident.slots?.threads ?? []).map((thread) =>
      Object.assign({}, thread, {
        modelId: resident.modelId,
        residentId: resident.residentId,
        stage: resident.inference.slotStages?.[String(thread.slot)] ?? null,
      }),
    ),
  );
  return {
    slots: {
      total: residents.reduce((sum, row) => sum + (row.slots?.total ?? 0), 0),
      busy: residents.reduce((sum, row) => sum + (row.slots?.busy ?? 0), 0),
      prefill: residents.reduce((sum, row) => sum + (row.slots?.prefill ?? 0), 0),
      decode: residents.reduce((sum, row) => sum + (row.slots?.decode ?? 0), 0),
      threads,
    },
    inference: {
      processing: residents.reduce((sum, row) => sum + row.inference.processing, 0),
      thinking: residents.reduce((sum, row) => sum + row.inference.thinking, 0),
      generating: residents.reduce((sum, row) => sum + row.inference.generating, 0),
    },
  };
}
function activity(status: BrainStatus | null) {
  const job = status?.jobs.find((row) => row.state === "running" || row.state === "queued");
  const operation = job?.operation ?? null;
  return { kind: operation === "pull" || operation === "runtime-install" ? "download" : operation };
}
function modelDetails(status: BrainStatus | null) {
  const first = status?.residents[0];
  return {
    queued: status?.queued ?? 0,
    activity: activity(status),
    model: status?.model ?? null,
    modelId: status?.modelId ?? null,
    vramBytes: first?.vramBytes ?? null,
    loadSeconds: first?.loadSeconds ?? null,
    startedAt: first?.startedAt ?? null,
    waitingModelIds: status?.scheduler.waitingModelIds ?? {},
  };
}

export function statusToView(
  state: BrainConnectionStateSnapshot,
  resources: BrainResources | null,
  telemetry: BrainTelemetry | null = null,
): BrainHostStatus {
  const status = state.feed?.connection === "connected" ? state.feed.status : null;
  const residents = status?.residents ?? [];
  return {
    running: Boolean(status?.running),
    reachable: Boolean(status),
    state: lifecycle(state),
    lastError: state.feed?.error ?? state.error?.message ?? null,
    reasoning: residents.some((row) => row.reasoning),
    ...hostIdentity(state),
    ...modelDetails(status),
    capabilities: capabilities(state),
    residents: residents.map((row) => ({
      residentId: row.residentId,
      modelId: row.modelId,
      model: row.model,
      state: row.state,
    })),
    resources,
    telemetry: status ? (telemetry ?? status.telemetry) : null,
    ...residentActivity(residents),
  };
}
function lifecycle(state: BrainConnectionStateSnapshot): BrainHostStatus["state"] {
  if (!state.connection) return "unconfigured";
  if (!state.connection.config.enabled) return "stopped";
  if (state.feed?.connection === "connected" && state.feed.status) {
    if (state.feed.status.running && state.feed.status.state === "stopped") return "ready";
    return state.feed.status.state;
  }
  if (state.connection.config.mode === "local" && !state.localRunning) return "stopped";
  return state.feed?.connection === "connecting" ? "starting" : "unreachable";
}
