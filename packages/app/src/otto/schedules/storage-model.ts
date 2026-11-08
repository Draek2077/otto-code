import type { ScheduleApi } from "./api";
import { ScheduleOperation } from "./operation";

type Defaults = Awaited<ReturnType<ScheduleApi["defaults"]>>;
type Storage = Awaited<ReturnType<ScheduleApi["storage"]>>;
export class ScheduleStorageModel {
  readonly lane = new ScheduleOperation();
  private listeners = new Set<() => void>();
  private state: {
    defaults: Defaults | null;
    storage: Storage | null;
    defaultDraft: "repository" | "host";
    projectDraft: "repository" | "host" | null;
  } = { defaults: null, storage: null, defaultDraft: "repository", projectDraft: null };
  constructor(
    readonly api: ScheduleApi,
    readonly hostId: string,
    readonly projectId: string | null,
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
    void this.reload();
    return release;
  }
  default(value: "repository" | "host") {
    if (!this.lane.getSnapshot().busy && !this.lane.getSnapshot().blocked)
      this.publish({ defaultDraft: value });
  }
  project(value: "repository" | "host" | null) {
    if (!this.lane.getSnapshot().busy && !this.lane.getSnapshot().blocked)
      this.publish({ projectDraft: value });
  }
  async reload(confirm?: () => Promise<boolean>) {
    await this.lane.run({
      confirm,
      inspected: !!confirm,
      operation: async () => ({
        defaults: await this.api.defaults({ hostId: this.hostId }),
        storage: this.projectId
          ? await this.api.storage({ hostId: this.hostId, projectId: this.projectId })
          : null,
      }),
      apply: ({ defaults, storage }) =>
        this.publish({
          defaults,
          storage,
          defaultDraft: defaults.location,
          projectDraft: storage?.override ?? null,
        }),
    });
  }
  async saveDefault() {
    const value = this.state.defaults;
    if (!value) return;
    const location = this.state.defaultDraft;
    await this.lane.run({
      write: true,
      operation: () =>
        this.api.saveDefaults({ hostId: this.hostId, expectedRevision: value.revision, location }),
      apply: (defaults) => this.publish({ defaults, defaultDraft: defaults.location }),
      message: "Schedules host default saved. Existing records stay at their original locations.",
    });
  }
  async saveProject() {
    const value = this.state.storage;
    if (!value) return;
    const location = this.state.projectDraft;
    await this.lane.run({
      write: true,
      operation: () =>
        this.api.saveStorage({ scope: value.scope, expectedRevision: value.revision, location }),
      apply: (storage) => this.publish({ storage, projectDraft: storage.override }),
      message: "Schedules project override saved. No records were moved or hidden.",
    });
  }
}
