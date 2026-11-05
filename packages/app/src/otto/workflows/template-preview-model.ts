import { z } from "zod";
import type { workflowPreviewTemplate } from "@getpaseo/plugin/otto/workflows";
import type { WorkflowDraft } from "./draft";
type Input = z.input<typeof workflowPreviewTemplate.input>;
export class WorkflowTemplatePreviewForm {
  private listeners = new Set<() => void>();
  private active = false;
  private authority = 0;
  private state = {
    variables: "{}",
    allowCode: false,
    busy: false,
    error: "",
    text: "",
    version: -1,
  };
  constructor(readonly draft: WorkflowDraft) {}
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
      }
    };
  }
  variables(variables: string) {
    this.publish({ variables, text: "" });
  }
  allow(allowCode: boolean) {
    this.publish({ allowCode, text: "" });
  }
  async preview(port: (input: Input) => Promise<{ text: string }>) {
    if (!this.active || this.state.busy) return;
    const source = this.draft.getSnapshot(),
      id = this.authority;
    if (source.document.kind !== "template") return;
    this.publish({ busy: true, error: "", text: "" });
    try {
      const variables = z.record(z.string(), z.unknown()).parse(JSON.parse(this.state.variables));
      const result = await port({
        scope: this.draft.scope,
        template: source.document.value,
        variables,
        allowCode: this.state.allowCode,
      });
      if (id === this.authority && this.draft.getSnapshot().version === source.version)
        this.publish({ text: result.text, version: source.version });
    } catch (error) {
      if (id === this.authority)
        this.publish({
          error: error instanceof Error ? error.message : "Template preview failed.",
        });
    } finally {
      this.publish({ busy: false });
    }
  }
}
