import { gitFetchError, type GitFetchPort } from "./port";

/** One explicit action's state, scoped to its owning host/workspace. No background work. */
export class ManualGitFetch {
  private state: { status: "idle" | "pending" | "success"; error: string | null } = {
    status: "idle",
    error: null,
  };
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly port: GitFetchPort | null,
    private readonly workspaceId: string | null | undefined,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: typeof this.state) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async run() {
    if (!this.port || !this.workspaceId || this.state.status === "pending") return;
    this.publish({ status: "pending", error: null });
    try {
      await this.port.fetch(this.workspaceId);
      this.publish({ status: "success", error: null });
    } catch (error) {
      this.publish({ status: "idle", error: gitFetchError(error) });
    }
  }
}

export function manualGitPresentation(snapshot: ReturnType<ManualGitFetch["getSnapshot"]>) {
  // Paseo's menu "success" state is terminal and disables the row. Fetch is
  // repeatable; its normal toast acknowledges success without a reset timer.
  const status: "idle" | "pending" = snapshot.status === "pending" ? "pending" : "idle";
  return { status, label: snapshot.error ? "Fetch failed; try again" : "Fetch" };
}
