import type {
  ScheduleDocument,
  ScheduleRef,
  ScheduleRunSummary,
} from "@getpaseo/plugin/otto/schedules";
import type { ScheduleApi } from "./api";
import { ScheduleOperation } from "./operation";

type Run = Awaited<ReturnType<ScheduleApi["run"]>>;
type Part = Awaited<ReturnType<ScheduleApi["part"]>>;
type Command = Parameters<ScheduleApi["control"]>[0]["command"];
export class ScheduleDetailModel {
  readonly lane = new ScheduleOperation();
  private listeners = new Set<() => void>();
  private state: {
    document: ScheduleDocument | null;
    history: ScheduleRunSummary[];
    total: number;
    offset: number;
    selectedRun: Run | null;
    selectedRunId: string | null;
    part: Part | null;
    deleted: boolean;
    acceptedRunId: string | null;
  } = {
    document: null,
    history: [],
    total: 0,
    offset: 0,
    selectedRun: null,
    selectedRunId: null,
    part: null,
    deleted: false,
    acceptedRunId: null,
  };
  constructor(
    readonly api: ScheduleApi,
    readonly ref: ScheduleRef,
  ) {}
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
    const release = this.lane.activate();
    void this.refresh();
    return release;
  }
  async refresh(confirm?: () => Promise<boolean>) {
    await this.lane.run({
      confirm,
      inspected: !!confirm,
      operation: async () => ({
        document: await this.api.read(this.ref),
        history: await this.api.history({ ref: this.ref, offset: this.state.offset }),
      }),
      apply: (result) =>
        this.publish({
          document: result.document,
          history: result.history.runs,
          total: result.history.total,
        }),
    });
  }
  async page(offset: number) {
    await this.lane.run({
      operation: () => this.api.history({ ref: this.ref, offset }),
      apply: (history) => this.publish({ history: history.runs, total: history.total, offset }),
    });
  }
  async control(command: Command, confirm: () => Promise<boolean>) {
    const document = this.state.document;
    if (!document) return;
    await this.lane.run({
      write: true,
      confirm,
      operation: () =>
        this.api.control({ ref: this.ref, expectedRevision: document.revision, command }),
      apply: (result) =>
        this.publish({
          document: result.entry ?? document,
          deleted: result.deleted === true,
          acceptedRunId: result.acceptedRunId ?? this.state.acceptedRunId,
        }),
      message:
        command.type === "run-once"
          ? "Run admitted. History will record the owning target's outcome."
          : "Schedule action confirmed by its owning host.",
    });
  }
  async run(id: string) {
    await this.lane.run({
      operation: () => this.api.run({ ref: this.ref, runId: id }),
      apply: (selectedRun) => this.publish({ selectedRun, selectedRunId: id, part: null }),
    });
  }
  async part(part: number) {
    const run = this.state.selectedRun,
      id = this.state.selectedRunId;
    if (!run || run.kind !== "stored" || !id) return;
    await this.lane.run({
      operation: () =>
        this.api.part({ ref: this.ref, runId: id, contentRevision: run.content.revision, part }),
      apply: (value) => this.publish({ part: value }),
    });
  }
}
