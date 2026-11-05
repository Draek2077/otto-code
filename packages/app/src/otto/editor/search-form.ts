import type { EditorSearchOptions } from "@getpaseo/plugin/otto/editor";
export class EditorSearchForm {
  private snapshot: { options: EditorSearchOptions; replacement: string; searched: string } = {
    options: {
      query: "",
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      include: "",
      exclude: "",
    } satisfies EditorSearchOptions,
    replacement: "",
    searched: "",
  };
  private readonly listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  edit(patch: Partial<EditorSearchOptions>) {
    this.publish({ options: { ...this.snapshot.options, ...patch } });
  }
  replace(replacement: string) {
    this.publish({ replacement });
  }
  searched(options: EditorSearchOptions) {
    this.publish({ searched: JSON.stringify(options) });
  }
  get stale() {
    return this.snapshot.searched !== JSON.stringify(this.snapshot.options);
  }
  private publish(patch: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
