import {
  WorkflowPortablePackage,
  normalizeWorkflowEntry,
  type WorkflowScope,
} from "@getpaseo/plugin/otto/workflows";
import type { WorkflowApi } from "./api";
export class WorkflowImportForm {
  private listeners = new Set<() => void>();
  private authority = 0;
  private active = false;
  private state: {
    text: string;
    newId: string;
    destination: "repository" | "host";
    review: Awaited<ReturnType<WorkflowApi["reviewImport"]>> | null;
    operationId: string;
    busy: boolean;
    blocked: boolean;
    error: string;
    message: string;
    inspection: Awaited<ReturnType<WorkflowApi["inspectImport"]>> | null;
  };
  constructor(readonly scope: WorkflowScope) {
    this.state = {
      text: "",
      newId: "",
      destination: "repository",
      review: null,
      operationId: `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      busy: false,
      blocked: false,
      error: "",
      message: "",
      inspection: null,
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
    const id = ++this.authority;
    return () => {
      if (id === this.authority) {
        this.active = false;
        ++this.authority;
        if (this.state.busy)
          this.publish({
            blocked: true,
            error:
              "Import may have completed. Inspect this operation receipt before another write.",
          });
      }
    };
  }
  text(text: string) {
    if (!this.state.busy && !this.state.blocked) this.publish({ text, review: null });
  }
  id(newId: string) {
    if (!this.state.busy && !this.state.blocked) this.publish({ newId, review: null });
  }
  receipt(operationId: string) {
    if (!this.state.busy)
      this.publish({
        operationId,
        blocked: true,
        review: null,
        inspection: null,
        message: "",
        error: "Inspect this previous operation before reconciling. No import will be replayed.",
      });
  }
  destination(value: string) {
    if (value !== "host" && value !== "repository") return;
    if (!this.state.busy && !this.state.blocked) this.publish({ destination: value, review: null });
  }
  async review(api: Pick<WorkflowApi, "reviewImport">) {
    if (!this.active || this.state.busy || this.state.blocked) return;
    const id = this.authority;
    this.publish({ busy: true, error: "", review: null });
    try {
      if (this.state.text.length > 2000000) throw new Error("Import exceeds 2 MB.");
      const exported = WorkflowPortablePackage.parse(JSON.parse(this.state.text));
      const review = await api.reviewImport({
        scope: this.scope,
        exported,
        destination: this.state.destination,
        operationId: this.state.operationId,
        ...(this.state.newId ? { newId: this.state.newId } : {}),
      });
      if (id === this.authority) this.publish({ review });
    } catch (error) {
      if (id === this.authority)
        this.publish({ error: error instanceof Error ? error.message : "Import review failed." });
    } finally {
      this.publish({ busy: false });
    }
  }
  async commit(api: Pick<WorkflowApi, "commitImport">) {
    if (!this.active || this.state.busy || this.state.blocked || !this.state.review) return null;
    const id = this.authority,
      token = this.state.review.token;
    this.publish({ busy: true, error: "" });
    try {
      const outcome = await api.commitImport({
        scope: this.scope,
        token,
        operationId: this.state.operationId,
        confirmed: true,
      });
      if (id !== this.authority) return null;
      this.publish({ blocked: true, message: outcome.message, review: null });
      return outcome.status === "committed" ? normalizeWorkflowEntry(outcome.entry) : null;
    } catch (error) {
      if (id === this.authority)
        this.publish({
          blocked: true,
          error:
            error instanceof Error
              ? error.message
              : "Import was not acknowledged. Inspect receipt.",
        });
      return null;
    } finally {
      this.publish({ busy: false });
    }
  }
  async inspect(api: Pick<WorkflowApi, "inspectImport">) {
    if (!this.active || this.state.busy) return;
    const id = this.authority;
    this.publish({ busy: true });
    try {
      const inspection = await api.inspectImport({
        scope: this.scope,
        operationId: this.state.operationId,
      });
      if (id === this.authority) this.publish({ inspection });
    } catch (error) {
      if (id === this.authority)
        this.publish({ error: error instanceof Error ? error.message : "Inspection failed." });
    } finally {
      this.publish({ busy: false });
    }
  }
  async reconcile(api: Pick<WorkflowApi, "reconcileImport">) {
    const inspected = this.state.inspection;
    if (!this.active || this.state.busy || !inspected?.matches || !inspected.currentRevision)
      return;
    const id = this.authority;
    this.publish({ busy: true });
    try {
      const outcome = await api.reconcileImport({
        scope: this.scope,
        operationId: this.state.operationId,
        expectedRevision: inspected.revision,
        expectedDocumentRevision: inspected.currentRevision,
        confirmed: true,
      });
      if (id === this.authority) this.publish({ message: outcome.message });
    } catch (error) {
      if (id === this.authority)
        this.publish({ error: error instanceof Error ? error.message : "Reconciliation failed." });
    } finally {
      this.publish({ busy: false });
    }
  }
}
