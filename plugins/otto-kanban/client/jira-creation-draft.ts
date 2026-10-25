import type { JiraCreateOptions, Result } from "../shared/model.js";

export interface JiraCreateSelection {
  projectId?: string;
  issueTypeId?: string;
}
export type ReadJiraCreation = (
  selection: JiraCreateSelection,
) => Promise<Result<JiraCreateOptions>>;
export class JiraCreationDraft {
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private state = {
    projectId: "",
    projectLabel: "",
    issueTypeId: "",
    issueTypeLabel: "",
    options: null as JiraCreateOptions | null,
    busy: false,
    error: "",
  };
  constructor(
    private readonly read: ReadJiraCreation | undefined,
    private readonly changed: (edited: boolean) => void,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<typeof this.state>, edited = false) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
    this.changed(edited);
  }
  activate() {
    this.active = true;
    if (!this.state.options) void this.reload();
    return () => {
      this.active = false;
      this.epoch++;
      this.publish({ busy: false, ...(this.state.busy ? { options: null } : {}) });
    };
  }
  selectProject = (projectId: string) => {
    const project = this.state.options?.projects.find((row) => row.id === projectId);
    if (projectId && !project) return;
    this.publish(
      {
        projectId,
        projectLabel: project?.label ?? "",
        issueTypeId: "",
        issueTypeLabel: "",
        options: this.state.options
          ? { ...this.state.options, issueTypes: [], available: false, revision: null }
          : null,
      },
      true,
    );
    void this.reload();
  };
  selectType = (issueTypeId: string) => {
    const issueType = this.state.options?.issueTypes.find((row) => row.id === issueTypeId);
    if (issueTypeId && !issueType) return;
    this.publish({ issueTypeId, issueTypeLabel: issueType?.label ?? "" }, true);
    void this.reload();
  };
  reload = async () => {
    if (!this.active) return;
    const epoch = ++this.epoch;
    this.publish({ busy: true, error: "" });
    try {
      if (!this.read) throw new Error("Creation adapter unavailable");
      const result = await this.read({
        ...(this.state.projectId ? { projectId: this.state.projectId } : {}),
        ...(this.state.issueTypeId ? { issueTypeId: this.state.issueTypeId } : {}),
      });
      if (!this.active || epoch !== this.epoch) return;
      if (!result.ok) this.publish({ busy: false, error: result.error.message, options: null });
      else this.publish({ busy: false, options: result.value });
    } catch {
      if (this.active && epoch === this.epoch)
        this.publish({
          busy: false,
          options: null,
          error: "Jira creation choices could not be read. Your local draft is retained.",
        });
    }
  };
  mutation() {
    const { projectId, issueTypeId, options, busy, error } = this.state;
    if (busy || error || !projectId || !issueTypeId || !options?.available || !options.revision)
      return null;
    return { projectId, issueTypeId, expectedCreateRevision: options.revision };
  }
}
