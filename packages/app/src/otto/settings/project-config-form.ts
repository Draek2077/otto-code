import type {
  PaseoConfigRaw,
  PaseoConfigRevision,
  ProjectConfigRpcError,
} from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  applyDraftToConfig,
  configToDraft,
  type ProjectConfigDraft,
} from "@/utils/project-config-form";

type ReadResult = Awaited<ReturnType<DaemonClient["readProjectConfig"]>>;
type WriteResult = Awaited<ReturnType<DaemonClient["writeProjectConfig"]>>;
interface Snapshot {
  draft: ProjectConfigDraft;
  error: ProjectConfigRpcError | null;
  pending: boolean;
  reading: boolean;
  dirty: boolean;
}

/** Otto preference autosave. One writer and revision origin per open project;
 * background reads cannot reconstruct the form or erase newer edits. */
export class ProjectConfigSettingsForm {
  private state: Snapshot;
  private base: PaseoConfigRaw;
  private revision: PaseoConfigRevision | null;
  private listeners = new Set<() => void>();
  private active = false;
  private authority = 0;
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    config: PaseoConfigRaw,
    revision: PaseoConfigRevision | null,
    private readonly port: {
      read(): Promise<ReadResult>;
      write(config: PaseoConfigRaw, revision: PaseoConfigRevision | null): Promise<WriteResult>;
      valid(draft: ProjectConfigDraft): boolean;
      accepted(value: Extract<WriteResult, { ok: true }>): void;
    },
  ) {
    this.base = config;
    this.revision = revision;
    this.state = {
      draft: configToDraft(config),
      error: null,
      pending: false,
      reading: false,
      dirty: false,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    return () => {
      if (authority !== this.authority) return;
      this.active = false;
      this.authority++;
      clearTimeout(this.timer);
      if (this.state.pending) this.publish({ error: { code: "write_failed" } });
    };
  }
  edit(updater: (draft: ProjectConfigDraft) => ProjectConfigDraft) {
    if (!this.active || this.state.reading) return;
    this.version++;
    this.publish({ draft: updater(this.state.draft), dirty: true });
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (
      this.active &&
      !this.state.pending &&
      !this.state.error &&
      this.state.dirty &&
      this.port.valid(this.state.draft)
    )
      this.timer = setTimeout(() => {
        void this.save();
      }, 300);
  }
  async save() {
    if (
      !this.active ||
      this.state.pending ||
      this.state.error ||
      !this.state.dirty ||
      !this.port.valid(this.state.draft)
    )
      return;
    clearTimeout(this.timer);
    const authority = this.authority;
    const version = this.version;
    const draft = this.state.draft;
    this.publish({ pending: true });
    try {
      const result = await this.port.write(
        applyDraftToConfig({ draft, base: this.base }),
        this.revision,
      );
      if (authority !== this.authority) return;
      if (!result.ok) {
        this.publish({ error: result.error });
        return;
      }
      this.base = result.config ?? {};
      this.revision = result.revision;
      this.publish({ dirty: version !== this.version });
      this.port.accepted(result);
    } catch {
      if (authority === this.authority) this.publish({ error: { code: "write_failed" } });
    } finally {
      this.publish({ pending: false });
      if (authority === this.authority) this.schedule();
    }
  }
  async reload() {
    if (!this.active || this.state.pending) return;
    clearTimeout(this.timer);
    const authority = this.authority;
    this.publish({ pending: true, reading: true });
    try {
      const result = await this.port.read();
      if (authority !== this.authority) return;
      if (!result.ok) {
        this.publish({ error: result.error });
        return;
      }
      this.base = result.config ?? {};
      this.revision = result.revision;
      this.publish({ draft: configToDraft(this.base), dirty: false, error: null });
    } catch {
      if (authority === this.authority) this.publish({ error: { code: "write_failed" } });
    } finally {
      this.publish({ pending: false, reading: false });
    }
  }
}
