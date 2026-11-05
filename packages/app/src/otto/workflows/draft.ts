import {
  WorkflowAuthoredDocument,
  WorkflowOperationError,
  type WorkflowEntry,
  type WorkflowScope,
  type WorkflowLocation,
  type WorkflowRef,
  type OrchestrationGraph,
} from "@getpaseo/plugin/otto/workflows";
export interface WorkflowDraftState {
  document: WorkflowAuthoredDocument;
  origin: WorkflowEntry | null;
  dirty: boolean;
  busy: boolean;
  blocked: boolean;
  error: string;
  epoch: number;
  version: number;
}
export interface WorkflowDraftPorts {
  save(input: {
    scope: WorkflowScope;
    document: WorkflowAuthoredDocument;
    expectedRevision: string | null;
    ref?: WorkflowRef;
    location?: "repository" | "host";
  }): Promise<WorkflowEntry>;
  read(ref: WorkflowRef): Promise<WorkflowEntry>;
}
/** Only local edits live here. CAS origins never follow background query snapshots. */
let draftIdentity = 0;
export class WorkflowDraft {
  readonly localKey = ++draftIdentity;
  private readonly fieldErrors = new Map<string, string>();
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private state: WorkflowDraftState;
  constructor(
    readonly scope: WorkflowScope,
    document: WorkflowAuthoredDocument,
    origin: WorkflowEntry | null,
  ) {
    this.state = {
      document: structuredClone(document),
      origin,
      dirty: !origin,
      busy: false,
      blocked: false,
      error: "",
      epoch: 0,
      version: 0,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<WorkflowDraftState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    return () => {
      if (this.authority === authority) {
        this.active = false;
        ++this.authority;
        if (this.state.busy)
          this.publish({
            blocked: true,
            error: "The save may have completed. Reload the owning record before another write.",
          });
      }
    };
  }
  edit(document: WorkflowAuthoredDocument) {
    this.publish({
      document: structuredClone(document),
      dirty: true,
      version: this.state.version + 1,
    });
  }
  patch(path: readonly string[], value: unknown) {
    const document = structuredClone(this.state.document);
    let target: object = document;
    for (const key of path.slice(0, -1)) {
      if (["__proto__", "prototype", "constructor"].includes(key))
        throw new Error("Reserved field.");
      let child: unknown = Reflect.get(target, key);
      if (!child || typeof child !== "object") {
        child = {};
        Reflect.set(target, key, child);
      }
      if (typeof child !== "object" || !child) throw new Error("Invalid field path.");
      target = child;
    }
    const key = path.at(-1);
    if (!key || ["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("Invalid field.");
    if (value === undefined) Reflect.deleteProperty(target, key);
    else Reflect.set(target, key, value);
    this.edit(document);
  }
  graph(graph: OrchestrationGraph) {
    if (this.state.document.kind === "graph") this.edit({ kind: "graph", value: graph });
  }
  error(message: string, path = "form") {
    if (message) this.fieldErrors.set(path, message);
    else this.fieldErrors.delete(path);
    this.publish({ error: [...this.fieldErrors.values()].join("\n") });
  }
  async save(ports: WorkflowDraftPorts, location?: Exclude<WorkflowLocation, "legacy">) {
    if (!this.active || this.state.busy || this.state.blocked || this.fieldErrors.size) return null;
    const parsed = WorkflowAuthoredDocument.safeParse(this.state.document);
    if (!parsed.success) {
      this.publish({
        error: parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("\n"),
      });
      return null;
    }
    const authority = this.authority,
      version = this.state.version,
      origin = this.state.origin;
    this.publish({ busy: true, error: "" });
    try {
      const document = parsed.data;
      const entry = await ports.save({
        scope: this.scope,
        document,
        expectedRevision: origin?.revision ?? null,
        ...(origin ? { ref: origin.ref } : {}),
        ...(location ? { location } : {}),
      });
      if (authority !== this.authority) return null;
      const accepted = WorkflowAuthoredDocument.parse(entry.document);
      this.publish({
        origin: entry,
        document: this.state.version === version ? accepted : this.state.document,
        dirty: this.state.version !== version,
        epoch: this.state.epoch + 1,
      });
      return entry;
    } catch (error) {
      if (authority === this.authority)
        this.publish({
          blocked: !(error instanceof WorkflowOperationError && error.code === "invalid"),
          error:
            error instanceof Error
              ? error.message
              : "Save was not acknowledged. Inspect before another write.",
        });
      return null;
    } finally {
      this.publish({ busy: false });
    }
  }
  async reload(ports: WorkflowDraftPorts, confirm: () => Promise<boolean>) {
    if (!this.active || this.state.busy || !this.state.origin) return;
    const authority = this.authority,
      ref = this.state.origin.ref;
    if (!(await confirm()) || authority !== this.authority) return;
    this.publish({ busy: true });
    try {
      const entry = await ports.read(ref);
      if (authority !== this.authority) return;
      this.fieldErrors.clear();
      this.publish({
        origin: entry,
        document: WorkflowAuthoredDocument.parse(entry.document),
        dirty: false,
        blocked: false,
        error: "",
        epoch: this.state.epoch + 1,
      });
    } catch (error) {
      if (authority === this.authority)
        this.publish({ error: error instanceof Error ? error.message : "Reload failed." });
    } finally {
      this.publish({ busy: false });
    }
  }
}
