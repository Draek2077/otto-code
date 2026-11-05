import {
  searchEditorFiles,
  planEditorReplace,
  applyEditorRename,
  undoEditorRename,
  type EditorSearchResult,
  type EditorSearchOptions,
  type EditorEditOutcome,
} from "@getpaseo/plugin/otto/editor";
import type { EditorRpc } from "./client";
import type { CodeLocation } from "./surface";
import type { EditorReviewSnapshot, EditorReviewPort, EditorSearchPort } from "./workspace-ports";
/** Workspace search/review presentation without a synthetic open file or draft.
 * The host owns every search snapshot, review plan, write and undo record. */
export class EditorWorkspaceEdits implements EditorSearchPort, EditorReviewPort {
  private snapshot: EditorReviewSnapshot & { search: EditorSearchResult | null } = {
    panel: "none",
    editLabel: "Replace in files",
    error: null,
    busy: false,
    plan: null,
    outcome: null,
    search: null,
  };
  private readonly listeners = new Set<() => void>();
  private client: EditorRpc | null = null;
  private generation = 0;
  private writing = false;
  constructor(
    private readonly options: {
      hostId: string;
      root: string;
      workspaceId?: string | null;
      navigate(location: CodeLocation): void;
      close(): void;
    },
  ) {}
  get contextScope() {
    return {
      hostId: this.options.hostId,
      root: this.options.root,
      workspaceId: this.options.workspaceId,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  connect(client: EditorRpc | null) {
    this.client = client?.hostId === this.options.hostId ? client : null;
    this.generation++;
    if (!this.client)
      this.publish({
        panel: "none",
        busy: false,
        plan: null,
        error: this.writing
          ? "A workspace edit was still running. Inspect the files before planning another replacement."
          : null,
      });
  }
  navigate = (location: CodeLocation) => this.options.navigate(location);
  toggleSearch = () => this.options.close();
  closePanel = () => this.publish({ panel: "none" });
  async searchFiles(options: EditorSearchOptions) {
    const client = this.client;
    if (!client || this.snapshot.busy || this.writing) return;
    const generation = this.generation;
    this.publish({ busy: true, error: null });
    try {
      const search = await client.call(searchEditorFiles, {
        hostId: client.hostId,
        root: this.options.root,
        options,
      });
      if (generation === this.generation) this.publish({ search });
    } catch (error) {
      if (generation === this.generation) this.publish({ error: failure(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  async planReplace(replacement: string, files: string[]) {
    const client = this.client,
      search = this.snapshot.search;
    if (!client || !search || this.snapshot.busy || this.writing) return;
    const generation = this.generation;
    this.publish({ busy: true, error: null });
    try {
      const plan = await client.call(planEditorReplace, {
        hostId: client.hostId,
        searchId: search.searchId,
        replacement,
        files,
      });
      if (generation === this.generation) this.publish({ plan, outcome: null, panel: "rename" });
    } catch (error) {
      if (generation === this.generation) this.publish({ error: failure(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  async applyRename() {
    const client = this.client,
      plan = this.snapshot.plan;
    if (!client || !plan) return;
    await this.write(() =>
      client.call(applyEditorRename, { hostId: client.hostId, planId: plan.planId }),
    );
  }
  async undoRename() {
    const client = this.client,
      outcome = this.snapshot.outcome;
    if (!client || !outcome) return;
    await this.write(() =>
      client.call(undoEditorRename, { hostId: client.hostId, runId: outcome.runId }),
    );
  }
  private async write(operation: () => Promise<EditorEditOutcome>) {
    if (this.writing || this.snapshot.busy) return;
    const generation = this.generation;
    this.writing = true;
    this.publish({ busy: true, error: null });
    try {
      const outcome = await operation();
      if (generation === this.generation) this.publish({ outcome, plan: null });
    } catch (error) {
      if (generation === this.generation) this.publish({ error: failure(error) });
    } finally {
      this.writing = false;
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
}
function failure(error: unknown) {
  return error instanceof Error ? error.message : "The workspace edit failed.";
}
