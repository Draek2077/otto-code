import type { BrainView } from "../screens/contracts/port";

/** One installation-owned resource; retained consumers share its read and stable snapshot. */
export class BrainResource<T> {
  private epoch = 0;
  private pending: Promise<T> | null = null;
  private demand = 0;
  private refreshRequested = false;
  private acceptedVersion = 0;
  private snapshot: BrainView<T>;
  constructor(
    private readonly fetcher: () => Promise<T>,
    private readonly changed: () => void,
  ) {
    this.snapshot = this.empty();
  }
  private empty(): BrainView<T> {
    return {
      data: undefined,
      error: null,
      isLoading: false,
      isFetching: false,
      isError: false,
      refetch: this.refetch,
    };
  }
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<BrainView<T>>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.changed();
  }
  retain(): () => void {
    if (++this.demand === 1) this.refreshDemanded();
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.demand--;
        if (!this.demand) this.refreshRequested = false;
      }
    };
  }
  refreshDemanded(): void {
    if (!this.demand) return;
    // A revision event after a request began cannot be satisfied by that older
    // request. Coalesce the event burst into one demanded read after it settles.
    if (this.pending) {
      this.refreshRequested = true;
      return;
    }
    void this.read().catch(() => {}); // Error is published to the requesting surface.
  }
  refetch = async (): Promise<void> => {
    await this.refresh();
  };
  async refresh(): Promise<T> {
    const epoch = this.epoch;
    // Explicit post-mutation reads must begin after this intent, even when a
    // pre-mutation query is still in flight or eventually fails.
    if (this.pending) {
      await this.pending.catch(() => undefined);
      if (epoch !== this.epoch)
        throw new Error("The Brain owner changed. Refresh its current data before continuing.");
    }
    return this.read();
  }
  async read(): Promise<T> {
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    const acceptedVersion = this.acceptedVersion;
    this.publish({
      isLoading: this.snapshot.data === undefined,
      isFetching: true,
      error: null,
      isError: false,
    });
    const pending = this.fetcher()
      .then(
        (data) => {
          if (epoch === this.epoch && acceptedVersion === this.acceptedVersion)
            this.publish({ data, isLoading: false, isFetching: false });
          return data;
        },
        (error: unknown) => {
          const failure =
            error instanceof Error ? error : new Error("Brain data could not be read");
          if (epoch === this.epoch && acceptedVersion === this.acceptedVersion)
            this.publish({ error: failure, isError: true, isLoading: false, isFetching: false });
          throw failure;
        },
      )
      .finally(() => {
        if (this.pending !== pending) return;
        this.pending = null;
        const refresh = this.refreshRequested;
        this.refreshRequested = false;
        if (refresh && epoch === this.epoch) this.refreshDemanded();
      });
    this.pending = pending;
    return pending;
  }
  accept(data: T): void {
    this.acceptedVersion++;
    if (this.pending && this.demand) this.refreshRequested = true;
    this.publish({ data, error: null, isError: false, isLoading: false, isFetching: false });
  }
  invalidate(): void {
    this.epoch++;
    this.pending = null;
    this.refreshRequested = false;
    this.snapshot = this.empty();
  }
}
