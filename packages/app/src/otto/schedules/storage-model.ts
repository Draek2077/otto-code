import type { ScheduleApi } from "./api";
import { ScheduleOperation } from "./operation";

type Defaults = Awaited<ReturnType<ScheduleApi["defaults"]>>;
type Storage = Awaited<ReturnType<ScheduleApi["storage"]>>;
export class ScheduleStorageModel {
  readonly lane = new ScheduleOperation();
  private listeners = new Set<() => void>();
  private saving = false;
  private active = false;
  private state: {
    defaults: Defaults | null;
    storage: Storage | null;
    defaultDraft: "repository" | "host";
    projectDraft: "repository" | "host" | null;
  } = { defaults: null, storage: null, defaultDraft: "repository", projectDraft: null };
  constructor(
    readonly api: Pick<ScheduleApi, "defaults" | "storage" | "saveDefaults" | "saveStorage">,
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
    this.active = true;
    const release = this.lane.activate();
    if (!this.state.defaults) void this.reload();
    return () => {
      this.active = false;
      release();
    };
  }
  default(value: "repository" | "host") {
    if (!this.lane.getSnapshot().blocked) {
      this.publish({ defaultDraft: value });
      void this.flush();
    }
  }
  project(value: "repository" | "host" | null) {
    if (!this.lane.getSnapshot().blocked) {
      this.publish({ projectDraft: value });
      void this.flush();
    }
  }
  private async flush() {
    const lane = this.lane.getSnapshot();
    if (!this.active || this.saving || lane.busy || lane.blocked) return;
    this.saving = true;
    try {
      if (this.state.defaults && this.state.defaultDraft !== this.state.defaults.location)
        await this.saveDefault();
      if (
        !this.lane.getSnapshot().blocked &&
        this.state.storage &&
        this.state.projectDraft !== this.state.storage.override
      )
        await this.saveProject();
    } finally {
      this.saving = false;
    }
    const current = this.lane.getSnapshot();
    if (!this.active || current.error || current.blocked) return;
    if (
      (this.state.defaults && this.state.defaultDraft !== this.state.defaults.location) ||
      (this.state.storage && this.state.projectDraft !== this.state.storage.override)
    )
      void this.flush();
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
      apply: (defaults) =>
        this.publish({
          defaults,
          defaultDraft:
            this.state.defaultDraft === location ? defaults.location : this.state.defaultDraft,
        }),
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
      apply: (storage) =>
        this.publish({
          storage,
          projectDraft:
            this.state.projectDraft === location ? storage.override : this.state.projectDraft,
        }),
    });
  }
}
