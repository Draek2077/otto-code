import {
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowEntry,
  type WorkflowSeats,
  type WorkflowLimits,
} from "@getpaseo/plugin/otto/workflows";
import type { ArtifactRef } from "@getpaseo/plugin/otto/artifacts";
import type { ScheduleTargetCandidate } from "@getpaseo/plugin/otto/schedules";
import type { ReviewModelSelection } from "../knowledge/review-model-picker";

type Role = keyof WorkflowSeats;
type CandidateWorkflow = Extract<ScheduleTargetCandidate, { type: "workflow" }>;
type CandidateArtifact = Extract<ScheduleTargetCandidate, { type: "artifact-update" }>;
/** Only editable target intent, not a Workflow launcher or Artifact cache. */
export class ScheduleTargetModel {
  private listeners = new Set<() => void>();
  private pickerSnapshots = new Map<
    Role | "artifact",
    { selection: ReviewModelSelection | null; busy: boolean }
  >();
  private state: {
    kind: "agent" | "new-agent" | "workflow" | "artifact-update";
    workflow: CandidateWorkflow | null;
    artifact: CandidateArtifact | null;
    artifactText: string;
    artifactMode: "data" | "instruction";
    labels: Partial<Record<Role | "artifact", ReviewModelSelection>>;
    label: string;
    kindLabels: Partial<Record<"agent" | "new-agent" | "workflow" | "artifact-update", string>>;
    inputLabels: Record<string, string>;
  };
  constructor(
    private readonly changed: (target: ScheduleTargetCandidate | null, label: string) => void,
    private readonly writable: () => boolean,
    candidate: ScheduleTargetCandidate | null,
    label: string,
  ) {
    this.state = {
      kind: candidate?.type ?? "new-agent",
      workflow: candidate?.type === "workflow" ? structuredClone(candidate) : null,
      artifact: candidate?.type === "artifact-update" ? structuredClone(candidate) : null,
      artifactText: "{}",
      artifactMode: "data",
      labels: {},
      label,
      kindLabels: candidate ? { [candidate.type]: label } : {},
      inputLabels: {},
    };
    if (this.state.workflow)
      for (const role of ["conductor", "worker", "judge"] as const) {
        const seat = this.state.workflow.seats[role];
        if (seat.model)
          this.state.labels[role] = {
            provider: seat.provider,
            model: seat.model,
            providerLabel: seat.provider,
            modelLabel: seat.model,
          };
      }
    const update = this.state.artifact?.update;
    if (update) {
      this.state.artifactText = update.type === "data" ? update.json : update.instruction;
      this.state.artifactMode = update.type;
      if (update.type === "instruction")
        this.state.labels.artifact = {
          ...update.selection,
          providerLabel: update.selection.provider,
          modelLabel: update.selection.model,
        };
    }
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private emit() {
    this.state = { ...this.state, label: this.state.kindLabels[this.state.kind] ?? "" };
    this.changed(this.candidate(), this.state.label);
    for (const listener of this.listeners) listener();
  }
  private candidate(): ScheduleTargetCandidate | null {
    if (this.state.kind === "workflow") return this.state.workflow;
    if (this.state.kind !== "artifact-update" || !this.state.artifact) return null;
    let update: CandidateArtifact["update"];
    if (this.state.artifactMode === "data")
      update = { type: "data", json: this.state.artifactText };
    else {
      const selection = this.state.labels.artifact;
      if (!selection) return null;
      update = {
        type: "instruction",
        instruction: this.state.artifactText,
        selection: { provider: selection.provider, model: selection.model },
      };
    }
    return { ...this.state.artifact, update };
  }
  kind(kind: typeof this.state.kind) {
    if (!this.writable()) return;
    this.state.kind = kind;
    this.emit();
  }
  native(
    candidate: Extract<ScheduleTargetCandidate, { type: "agent" | "new-agent" }> | null,
    label: string,
  ) {
    if (this.writable()) this.changed(candidate, label);
  }
  workflow(entry: WorkflowEntry, label: string) {
    if (!this.writable()) return;
    const { document, ref } = entry;
    if ((document.kind !== "ai" && document.kind !== "graph") || ref.kind !== document.kind)
      throw new Error("Select a saved AI or Graph Workflow.");
    const empty = { provider: "" };
    this.state = {
      ...this.state,
      kind: "workflow",
      label,
      kindLabels: { ...this.state.kindLabels, workflow: label },
      workflow: {
        type: "workflow",
        source: { ...ref, kind: document.kind },
        workspaceId: "",
        seats:
          document.kind === "ai"
            ? structuredClone(document.value.seats)
            : { conductor: { ...empty }, worker: { ...empty }, judge: { ...empty } },
        limits:
          document.kind === "ai"
            ? structuredClone(document.value.limits)
            : { ...DEFAULT_WORKFLOW_LIMITS },
        inputs:
          document.kind === "graph"
            ? Object.fromEntries(
                (document.value.inputs ?? []).map((row) => [row.key, row.defaultValue ?? ""]),
              )
            : {},
        approval: { allowTemplateCode: false, allowQueryEffects: false },
      },
      inputLabels:
        document.kind === "graph"
          ? Object.fromEntries((document.value.inputs ?? []).map((row) => [row.key, row.label]))
          : {},
      labels: {},
    };
    if (this.state.workflow)
      for (const role of ["conductor", "worker", "judge"] as const) {
        const seat = this.state.workflow.seats[role];
        if (seat.model)
          this.state.labels[role] = {
            provider: seat.provider,
            model: seat.model,
            providerLabel: seat.provider,
            modelLabel: seat.model,
          };
      }
    this.emit();
  }
  artifact(ref: ArtifactRef, label: string) {
    if (!this.writable()) return;
    this.state = {
      ...this.state,
      kind: "artifact-update",
      label,
      kindLabels: { ...this.state.kindLabels, "artifact-update": label },
      artifact: { type: "artifact-update", source: ref, update: { type: "data", json: "{}" } },
    };
    this.emit();
  }
  workspace(workspaceId: string) {
    this.workflowEdit((value) => ({ ...value, workspaceId }));
  }
  input(key: string, value: string) {
    this.workflowEdit((row) => ({ ...row, inputs: { ...row.inputs, [key]: value } }));
  }
  limit(key: keyof WorkflowLimits, value: number) {
    this.workflowEdit((row) => ({ ...row, limits: { ...row.limits, [key]: value } }));
  }
  allow(key: "allowTemplateCode" | "allowQueryEffects", value: boolean) {
    this.workflowEdit((row) => ({ ...row, approval: { ...row.approval, [key]: value } }));
  }
  private workflowEdit(edit: (value: CandidateWorkflow) => CandidateWorkflow) {
    if (!this.writable() || !this.state.workflow) return;
    this.state.workflow = edit(this.state.workflow);
    this.emit();
  }
  seatOption(role: Role, key: "modeId" | "thinkingOptionId", value: string) {
    this.workflowEdit((row) => ({
      ...row,
      seats: { ...row.seats, [role]: { ...row.seats[role], [key]: value || undefined } },
    }));
  }
  artifactMode(mode: "data" | "instruction") {
    if (this.writable()) {
      this.state.artifactMode = mode;
      this.emit();
    }
  }
  clearArtifact() {
    if (!this.writable()) return;
    this.state.artifact = null;
    this.state.kindLabels = { ...this.state.kindLabels, "artifact-update": "" };
    this.emit();
  }
  artifactText(text: string) {
    if (this.writable()) {
      this.state.artifactText = text;
      this.emit();
    }
  }
  picker(role: Role | "artifact") {
    return {
      subscribe: this.subscribe,
      getSnapshot: () => {
        const selection = this.state.labels[role] ?? null,
          busy = !this.writable(),
          previous = this.pickerSnapshots.get(role);
        if (previous && previous.selection === selection && previous.busy === busy) return previous;
        const next = { selection, busy };
        this.pickerSnapshots.set(role, next);
        return next;
      },
      selectModel: (selection: ReviewModelSelection | null) => {
        if (!this.writable()) return;
        this.state.labels = { ...this.state.labels, [role]: selection ?? undefined };
        if (role !== "artifact" && this.state.workflow)
          this.state.workflow = {
            ...this.state.workflow,
            seats: {
              ...this.state.workflow.seats,
              [role]: selection
                ? { provider: selection.provider, model: selection.model }
                : { provider: "" },
            },
          };
        this.emit();
      },
    };
  }
}
