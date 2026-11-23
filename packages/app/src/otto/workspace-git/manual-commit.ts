export const commitTypes = [
  "none",
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
] as const;
export type CommitType = (typeof commitTypes)[number];
export interface CommitFile {
  path: string;
  oldPath?: string | null;
}

/** The same conventional header choices as git-cz; user-authored headers remain intact. */
export function manualCommitMessage(type: CommitType, text: string): string {
  const message = text.trim();
  return !message || type === "none" || /^\w+(\([^)]*\))?!?:\s/u.test(message)
    ? message
    : `${type}: ${message}`;
}

export class ManualCommitDraft {
  private state = {
    type: "none" as CommitType,
    message: "",
    pending: false,
    error: "",
    output: "",
    files: [] as readonly CommitFile[],
    excluded: new Set<string>(),
  };
  private readonly listeners = new Set<() => void>();
  constructor(
    private readonly commit: (
      message: string,
      paths: string[],
      output: (text: string) => void,
    ) => Promise<void>,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  edit(patch: Partial<Pick<typeof this.state, "type" | "message">>) {
    this.publish({ ...this.state, ...patch });
  }
  private publish(state: typeof this.state) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  setFiles(files: readonly CommitFile[]) {
    if (
      files.length === this.state.files.length &&
      files.every(
        (file, index) =>
          file.path === this.state.files[index]?.path &&
          file.oldPath === this.state.files[index]?.oldPath,
      )
    )
      return;
    const paths = new Set(files.map((file) => file.path));
    this.publish({
      ...this.state,
      files,
      excluded: new Set([...this.state.excluded].filter((path) => paths.has(path))),
    });
  }
  selected(path: string) {
    return !this.state.excluded.has(path);
  }
  toggle(path: string) {
    if (this.state.pending) return;
    const excluded = new Set(this.state.excluded);
    if (excluded.has(path)) excluded.delete(path);
    else excluded.add(path);
    this.publish({ ...this.state, excluded });
  }
  toggleAll() {
    if (this.state.pending) return;
    const all = this.state.excluded.size === 0;
    this.publish({
      ...this.state,
      excluded: new Set(all ? this.state.files.map((file) => file.path) : []),
    });
  }
  async submit(): Promise<boolean> {
    const origin = this.state;
    const message = manualCommitMessage(origin.type, origin.message);
    const selected = origin.files.filter((file) => !origin.excluded.has(file.path));
    const paths = [
      ...new Set(
        selected.flatMap((file) => (file.oldPath ? [file.path, file.oldPath] : [file.path])),
      ),
    ];
    if (origin.pending || !message || !paths.length) return false;
    this.publish({ ...origin, pending: true, error: "", output: "Commit started.\n" });
    try {
      await this.commit(message, paths, (output) => this.publish({ ...this.state, output }));
      const unchanged = this.state.message === origin.message;
      this.publish({ ...this.state, pending: false, message: unchanged ? "" : this.state.message });
      return unchanged;
    } catch (error) {
      this.publish({
        ...this.state,
        pending: false,
        error:
          error instanceof Error
            ? error.message
            : "Commit did not complete. Refresh Changes before trying again.",
      });
      return false;
    }
  }
}
