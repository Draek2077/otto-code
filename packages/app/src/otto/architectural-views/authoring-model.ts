import type { ReviewModelSelection } from "../knowledge/review-model-picker";
import type { ViewDraft } from "@getpaseo/plugin/otto/architectural-views";
interface State {
  selection: ReviewModelSelection | null;
  modeId?: string;
  thinkingOptionId?: string;
  workspaceId: string;
  busy: boolean;
  error: string | null;
  blocked: boolean;
}
export class ViewAuthoringModel {
  private state: State;
  private active = false;
  private authority = 0;
  private readonly listeners = new Set<() => void>();
  constructor(workspaceId: string) {
    this.state = { selection: null, workspaceId, busy: false, error: null, blocked: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  selectModel = (selection: ReviewModelSelection | null) =>
    this.publish({ selection, modeId: undefined, thinkingOptionId: undefined });
  workspace(value: string) {
    if (!this.state.busy) this.publish({ workspaceId: value });
  }
  mode(value: string) {
    this.publish({ modeId: value || undefined });
  }
  thinking(value: string) {
    this.publish({ thinkingOptionId: value || undefined });
  }
  activate() {
    this.active = true;
    const authority = ++this.authority;
    return () => {
      if (this.authority !== authority) return;
      this.active = false;
      this.authority++;
      if (this.state.busy) this.publish({ blocked: true });
    };
  }
  async start(
    action: (input: {
      workspaceId: string;
      selection: { provider: string; model: string; modeId?: string; thinkingOptionId?: string };
    }) => Promise<{ draft: ViewDraft; agentId: string }>,
  ) {
    if (
      !this.active ||
      this.state.busy ||
      this.state.blocked ||
      !this.state.selection ||
      !this.state.workspaceId
    )
      return null;
    const authority = this.authority,
      input = {
        workspaceId: this.state.workspaceId,
        selection: {
          provider: this.state.selection.provider,
          model: this.state.selection.model,
          modeId: this.state.modeId,
          thinkingOptionId: this.state.thinkingOptionId,
        },
      };
    this.publish({ busy: true, error: null });
    try {
      const result = await action(input);
      return this.active && authority === this.authority
        ? { ...result, workspaceId: input.workspaceId }
        : null;
    } catch (error) {
      if (this.active && authority === this.authority)
        this.publish({
          blocked: true,
          error:
            error instanceof Error
              ? error.message
              : "Chat creation was not acknowledged. Inspect the saved draft before another start.",
        });
      return null;
    } finally {
      this.publish({ busy: false });
    }
  }
}
