import {
  WorkflowLaunch,
  DEFAULT_WORKFLOW_LIMITS,
  type WorkflowEntry,
  type WorkflowSeats,
  type WorkflowLimits,
  type WorkflowLaunch as Launch,
} from "@getpaseo/plugin/otto/workflows";
import type { WorkflowApi } from "./api";
export interface SeatSelection {
  provider: string;
  model: string;
  providerLabel: string;
  modelLabel: string;
}
type Role = keyof WorkflowSeats;
export class WorkflowLaunchForm {
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private pickerSnapshots: Record<Role, { selection: SeatSelection | null; busy: boolean }> = {
    conductor: { selection: null, busy: false },
    worker: { selection: null, busy: false },
    judge: { selection: null, busy: false },
  };
  private state: {
    workspaceId: string;
    seats: WorkflowSeats;
    labels: Partial<Record<Role, SeatSelection>>;
    limits: WorkflowLimits;
    inputs: Record<string, string>;
    allowTemplateCode: boolean;
    allowQueryEffects: boolean;
    review: Awaited<ReturnType<WorkflowApi["review"]>> | null;
    operationId: string;
    busy: boolean;
    blocked: boolean;
    error: string;
    run: WorkflowEntry | null;
  };
  constructor(
    readonly entry: WorkflowEntry,
    workspaceId: string,
  ) {
    const doc = entry.document,
      empty = { provider: "" };
    this.state = {
      workspaceId,
      seats:
        doc.kind === "ai"
          ? structuredClone(doc.value.seats)
          : { conductor: { ...empty }, worker: { ...empty }, judge: { ...empty } },
      labels: {},
      limits:
        doc.kind === "ai" ? structuredClone(doc.value.limits) : { ...DEFAULT_WORKFLOW_LIMITS },
      inputs:
        doc.kind === "graph"
          ? Object.fromEntries(
              (doc.value.inputs ?? []).map((input) => [input.key, input.defaultValue ?? ""]),
            )
          : {},
      allowTemplateCode: false,
      allowQueryEffects: false,
      review: null,
      operationId: `launch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      busy: false,
      blocked: false,
      error: "",
      run: null,
    };
    for (const role of ["conductor", "worker", "judge"] as const) {
      const seat = this.state.seats[role];
      if (seat.model)
        this.state.labels[role] = {
          provider: seat.provider,
          model: seat.model,
          providerLabel: seat.provider,
          modelLabel: seat.model,
        };
    }
    this.updatePickers();
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private updatePickers() {
    for (const role of ["conductor", "worker", "judge"] as const) {
      const selection = this.state.labels[role] ?? null,
        current = this.pickerSnapshots[role];
      if (current.selection !== selection || current.busy !== this.state.busy)
        this.pickerSnapshots[role] = { selection, busy: this.state.busy };
    }
  }
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.updatePickers();
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const id = ++this.authority;
    return () => {
      if (id === this.authority) {
        this.active = false;
        ++this.authority;
        if (this.state.busy)
          this.publish({
            blocked: true,
            error:
              "The host may have accepted this launch. Inspect run history before another start.",
          });
      }
    };
  }
  private edit(patch: Partial<typeof this.state>) {
    if (!this.state.busy) this.publish({ ...patch, review: null });
  }
  workspace(id: string) {
    this.edit({ workspaceId: id });
  }
  seat(role: Role, selection: SeatSelection | null) {
    this.edit({
      seats: {
        ...this.state.seats,
        [role]: selection
          ? { provider: selection.provider, model: selection.model }
          : { provider: "" },
      },
      labels: { ...this.state.labels, [role]: selection ?? undefined },
    });
  }
  seatOption(role: Role, key: "modeId" | "thinkingOptionId", value: string) {
    this.edit({
      seats: {
        ...this.state.seats,
        [role]: { ...this.state.seats[role], [key]: value || undefined },
      },
    });
  }
  input(key: string, value: string) {
    this.edit({ inputs: { ...this.state.inputs, [key]: value } });
  }
  limit(key: keyof WorkflowLimits, value: string) {
    this.edit({ limits: { ...this.state.limits, [key]: Number(value) } });
  }
  allow(key: "allowTemplateCode" | "allowQueryEffects", value: boolean) {
    this.edit({ [key]: value });
  }
  private launch(): Launch {
    const document = this.entry.document,
      source = { ref: this.entry.ref, revision: this.entry.revision };
    if (document.kind === "ai")
      return WorkflowLaunch.parse({
        kind: "ai",
        definition: document.value,
        seats: this.state.seats,
        limits: this.state.limits,
        source,
      });
    if (document.kind !== "graph") throw new Error("Select an AI or Graph definition.");
    return WorkflowLaunch.parse({
      kind: "graph",
      graph: document.value,
      inputs: this.state.inputs,
      seats: this.state.seats,
      limits: this.state.limits,
      allowTemplateCode: this.state.allowTemplateCode,
      allowQueryEffects: this.state.allowQueryEffects,
      source,
    });
  }
  async review(api: Pick<WorkflowApi, "review">) {
    if (!this.active || this.state.busy || this.state.blocked) return;
    const id = this.authority;
    this.publish({ busy: true, error: "", review: null });
    try {
      const review = await api.review({
        scope: this.entry.ref.scope,
        workspaceId: this.state.workspaceId,
        launch: this.launch(),
        operationId: this.state.operationId,
      });
      if (id === this.authority) this.publish({ review });
    } catch (error) {
      if (id === this.authority)
        this.publish({ error: error instanceof Error ? error.message : "Review failed." });
    } finally {
      this.publish({ busy: false });
    }
  }
  async start(api: Pick<WorkflowApi, "start">) {
    if (!this.active || this.state.busy || this.state.blocked || !this.state.review) return null;
    const id = this.authority,
      review = this.state.review;
    this.publish({ busy: true, error: "" });
    try {
      const run = await api.start({
        scope: this.entry.ref.scope,
        token: review.token,
        operationId: this.state.operationId,
      });
      if (id !== this.authority) return null;
      this.publish({ run, review: null });
      return run;
    } catch (error) {
      if (id === this.authority)
        this.publish({
          blocked: true,
          error:
            error instanceof Error
              ? error.message
              : "Start was not acknowledged. Inspect run history.",
        });
      return null;
    } finally {
      this.publish({ busy: false });
    }
  }
  seatPicker(role: Role) {
    return {
      subscribe: this.subscribe,
      getSnapshot: () => this.pickerSnapshots[role],
      selectModel: (selection: SeatSelection | null) => this.seat(role, selection),
    };
  }
}
