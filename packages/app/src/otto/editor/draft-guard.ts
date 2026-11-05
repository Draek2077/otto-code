const guards = new Set<EditorDraftGuard>();
/** One status bit per mounted file model, including inactive tabs. Changes are
 * serialized, never polled. A workspace write waits for its own client's guards. */
export class EditorDraftGuard {
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  private modified: boolean | null = null;
  private revision = 0;
  constructor(
    readonly hostId: string,
    private readonly send: (modified: boolean, revision: number) => Promise<unknown>,
  ) {
    guards.add(this);
  }
  update(modified: boolean) {
    if (modified === this.modified) return;
    this.modified = modified;
    const revision = ++this.revision;
    this.pending = this.pending.then(async () => {
      try {
        await this.send(modified, revision);
        this.failure = null;
      } catch (error) {
        this.failure = error;
      }
      return undefined;
    });
  }
  async flush() {
    await this.pending;
    if (this.failure)
      throw new Error(
        "Draft protection could not be synchronized. Reconnect the host before applying workspace edits.",
        { cause: this.failure },
      );
  }
  async close() {
    this.update(false);
    await this.pending;
    guards.delete(this);
  }
}
export async function flushEditorDraftGuards(hostId: string) {
  await Promise.all(
    [...guards].filter((guard) => guard.hostId === hostId).map((guard) => guard.flush()),
  );
}
