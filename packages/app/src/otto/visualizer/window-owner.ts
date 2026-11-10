export interface VisualizerLease {
  id: string;
  priority: number;
  order: number;
}
/** Window-scoped renderer arbitration; retained tabs keep descriptors, not guests. */
export class VisualizerWindowOwner {
  private readonly leases = new Map<string, VisualizerLease>();
  private readonly listeners = new Set<() => void>();
  private nextOrder = 0;
  private winner: string | null = null;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.winner;
  retain(id: string, priority: number) {
    const lease = { id, priority, order: ++this.nextOrder };
    this.leases.set(id, lease);
    this.reconcile();
    return () => {
      if (this.leases.get(id) === lease) this.leases.delete(id);
      this.reconcile();
    };
  }
  private reconcile() {
    const next =
      [...this.leases.values()].sort(
        (left, right) => right.priority - left.priority || right.order - left.order,
      )[0]?.id ?? null;
    if (next === this.winner) return;
    this.winner = next;
    for (const listener of this.listeners) listener();
  }
}
export const visualizerWindowOwner = new VisualizerWindowOwner();
