import type { BrainView } from "../screens/contracts/port";

/** One installation-owned resource; retained consumers share its read and stable snapshot. */
export class BrainResource<T> {
  private epoch = 0;
  private pending: Promise<T> | null = null;
  private demand = 0;
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
      }
    };
  }
  refreshDemanded(): void {
    if (this.demand) void this.read().catch(() => {}); // Error is published to the requesting surface.
  }
  refetch = async (): Promise<void> => {
    await this.read();
  };
  async read(): Promise<T> {
    if (this.pending) return this.pending;
    const epoch = this.epoch;
    this.publish({
      isLoading: this.snapshot.data === undefined,
      isFetching: true,
      error: null,
      isError: false,
    });
    const pending = this.fetcher()
      .then(
        (data) => {
          if (epoch === this.epoch) this.publish({ data, isLoading: false, isFetching: false });
          return data;
        },
        (error: unknown) => {
          const failure =
            error instanceof Error ? error : new Error("Brain data could not be read");
          if (epoch === this.epoch)
            this.publish({ error: failure, isError: true, isLoading: false, isFetching: false });
          throw failure;
        },
      )
      .finally(() => {
        if (this.pending === pending) this.pending = null;
      });
    this.pending = pending;
    return pending;
  }
  accept(data: T): void {
    this.publish({ data, error: null, isError: false, isLoading: false, isFetching: false });
  }
  invalidate(): void {
    this.epoch++;
    this.pending = null;
    this.snapshot = this.empty();
  }
}
