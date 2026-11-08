import {
  ScheduleDraft,
  ScheduleTargetCandidate,
  type ScheduleDocument,
  type ScheduleScope,
} from "@getpaseo/plugin/otto/schedules";
import type { ScheduleCadence } from "@getpaseo/protocol/schedule/types";
import { ScheduleRequestError, type ScheduleApi } from "./api";

type Review = Awaited<ReturnType<ScheduleApi["review"]>>;
type Preview = Awaited<ReturnType<ScheduleApi["preview"]>>;
type Fields = Omit<ScheduleDraft, "target">;
type ProjectScope = ScheduleScope & { projectId: string };
function targetLabel(target: ScheduleTargetCandidate) {
  switch (target.type) {
    case "workflow":
      return `${target.source.kind} Workflow · ${target.source.id} · ${target.source.location}`;
    case "artifact-update":
      return `Artifact · ${target.source.id} · ${target.source.location}`;
    case "new-agent":
      return `${target.config.provider} · ${target.config.model ?? "Provider default"}`;
    case "agent":
      return `Existing agent · ${target.agentId}`;
  }
}

/** Local form lifetime only. The daemon owns definitions, revisions, claims and execution.
 * A form opening retains one creation intent. Inspection never resends that intent. */
export class ScheduleEditorModel {
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private writing = false;
  private state: {
    fields: Fields;
    candidate: ScheduleTargetCandidate | null;
    targetLabel: string;
    review: Review | null;
    approved: boolean;
    preview: Preview | null;
    document: ScheduleDocument | null;
    inspected: ScheduleDocument | null;
    busy: boolean;
    blocked: boolean;
    error: string;
    saved: ScheduleDocument | null;
    generation: number;
  };
  constructor(
    readonly api: ScheduleApi,
    readonly scope: ProjectScope,
    readonly operationId: string,
    document: ScheduleDocument | null = null,
  ) {
    if (
      document &&
      (document.ref.scope.hostId !== scope.hostId ||
        document.ref.scope.projectId !== scope.projectId)
    )
      throw new Error("Select the Schedule's owning project.");
    this.state = this.seed(document);
  }
  private seed(document: ScheduleDocument | null) {
    const schedule = document?.schedule;
    return {
      fields: {
        name: schedule?.name ?? null,
        prompt: schedule?.prompt ?? "",
        cadence: schedule?.cadence ?? {
          type: "cron" as const,
          expression: "0 9 * * *",
          timezone: "UTC",
        },
        maxRuns: schedule?.maxRuns ?? null,
        expiresAt: schedule?.expiresAt ?? null,
        runOnCreate: false,
      },
      candidate: schedule ? ScheduleTargetCandidate.parse(schedule.target) : null,
      targetLabel: schedule ? targetLabel(schedule.target) : "",
      review: null,
      approved: false,
      preview: null,
      document,
      inspected: null,
      busy: false,
      blocked: false,
      error: "",
      saved: null,
      generation: 0,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    return () => {
      if (authority !== this.authority) return;
      this.active = false;
      ++this.authority;
      if (this.writing)
        this.publish({
          blocked: true,
          error:
            "The host may have saved this Schedule. Inspect its creation intent or saved origin before another write.",
        });
    };
  }
  private editable() {
    return this.active && !this.state.busy && !this.state.blocked;
  }
  field<K extends keyof Fields>(key: K, value: Fields[K]) {
    if (!this.editable()) return;
    this.publish({
      fields: { ...this.state.fields, [key]: value },
      preview: key === "cadence" ? null : this.state.preview,
      error: "",
      saved: null,
    });
  }
  cadence = (value: ScheduleCadence) => this.field("cadence", value);
  target(candidate: ScheduleTargetCandidate | null, label: string) {
    if (!this.editable()) return;
    this.publish({
      candidate,
      targetLabel: label,
      review: null,
      approved: false,
      error: "",
      saved: null,
    });
  }
  approve(value: boolean) {
    if (this.editable() && this.state.review) this.publish({ approved: value });
  }
  private async read<T>(operation: () => Promise<T>, apply: (value: T) => void) {
    if (!this.active || this.state.busy) return;
    const authority = this.authority;
    this.publish({ busy: true, error: "" });
    try {
      const value = await operation();
      if (this.active && authority === this.authority) apply(value);
    } catch (error) {
      if (this.active && authority === this.authority)
        this.publish({
          error:
            error instanceof ScheduleRequestError
              ? error.message
              : "The host could not validate this Schedule. Refresh and inspect its source.",
        });
    } finally {
      this.publish({ busy: false });
    }
  }
  async preview() {
    if (!this.editable()) return;
    const cadence = this.state.fields.cadence;
    await this.read(
      () => this.api.preview({ scope: this.scope, cadence }),
      (preview) => this.publish({ preview }),
    );
  }
  async review() {
    if (!this.editable() || !this.state.candidate) return;
    const target = this.state.candidate;
    await this.read(
      () => this.api.review({ scope: this.scope, target }),
      (review) => this.publish({ review, approved: false }),
    );
  }
  canSave() {
    return this.editable() && !!this.state.preview && !!this.state.review && this.state.approved;
  }
  async save(): Promise<ScheduleDocument | null> {
    if (!this.canSave() || !this.state.review) return null;
    const parsed = ScheduleDraft.safeParse({
      ...this.state.fields,
      target: this.state.review.target,
    });
    if (
      !parsed.success ||
      !this.state.fields.prompt.trim() ||
      (parsed.data.expiresAt !== null && !Number.isFinite(Date.parse(parsed.data.expiresAt)))
    ) {
      this.publish({
        error:
          "Check the name, prompt, limits and expiry before saving. This request was not sent.",
      });
      return null;
    }
    const authority = this.authority,
      document = this.state.document;
    this.writing = true;
    this.publish({ busy: true, error: "" });
    try {
      const saved = document
        ? await this.api.update({
            ref: document.ref,
            expectedRevision: document.revision,
            draft: parsed.data,
          })
        : await this.api.create({
            scope: this.scope,
            operationId: this.operationId,
            draft: parsed.data,
          });
      if (!this.active || authority !== this.authority) return null;
      this.publish({ document: saved, saved });
      return saved;
    } catch (error) {
      if (this.active && authority === this.authority)
        this.publish({
          blocked: !(error instanceof ScheduleRequestError && error.origin === "local-validation"),
          error:
            error instanceof ScheduleRequestError
              ? error.message
              : "The save was not confirmed. Inspect the saved Schedule before another write.",
        });
      return null;
    } finally {
      this.writing = false;
      this.publish({ busy: false });
    }
  }
  async inspect() {
    await this.read(
      () =>
        this.state.document
          ? this.api.read(this.state.document.ref)
          : this.api.created({ scope: this.scope, operationId: this.operationId }),
      (inspected) =>
        this.publish({
          inspected,
          error: inspected
            ? "Inspect the saved record, then explicitly reload it to replace this draft."
            : "No saved record is visible for this creation intent yet. A pending write may still settle; inspect again before closing this draft.",
        }),
    );
  }
  /** Caller obtains explicit discard confirmation. No inspection or peer update rebases drafts. */
  async reloadInspected(confirm: () => Promise<boolean>) {
    if (!this.active || this.state.busy || !this.state.inspected) return;
    const authority = this.authority,
      inspected = this.state.inspected;
    if (
      !(await confirm()) ||
      !this.active ||
      this.authority !== authority ||
      this.state.inspected !== inspected ||
      this.state.busy
    )
      return;
    const generation = this.state.generation + 1;
    this.state = { ...this.seed(inspected), generation };
    this.publish({});
  }
}
