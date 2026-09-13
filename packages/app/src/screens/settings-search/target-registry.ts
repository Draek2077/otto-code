interface FocusTarget {
  focus: (isCurrent: () => boolean) => boolean | Promise<boolean>;
}

/** A request stays pending until the chosen Settings owner mounts and lays out its row. */
export class SettingsTargetRegistry {
  private targets = new Map<string, Set<FocusTarget>>();
  private revealers = new Map<string, () => void>();
  private requested: string | null = null;
  private completed = false;
  private generation = 0;
  private running = false;
  private revision = 0;
  private cancelFocus: (() => void) | null = null;
  private revealAttempted = new Set<() => void>();

  request(id: string | null): void {
    this.cancelFocus?.();
    this.requested = id;
    this.completed = false;
    this.generation++;
    this.revealAttempted.clear();
    this.tryFocus();
  }

  register(id: string, target: FocusTarget): () => void {
    const targets = this.targets.get(id) ?? new Set<FocusTarget>();
    targets.add(target);
    this.targets.set(id, targets);
    this.revision++;
    this.tryFocus();
    return () => {
      targets.delete(target);
      this.cancelFocus?.();
      if (targets.size === 0) this.targets.delete(id);
      this.revision++;
      this.tryFocus();
    };
  }

  registerReveal(ids: readonly string[], reveal: () => void): () => void {
    for (const id of ids) this.revealers.set(id, reveal);
    this.tryFocus();
    return () => {
      for (const id of ids) if (this.revealers.get(id) === reveal) this.revealers.delete(id);
    };
  }

  /** Mount/layout events retry; there is no timer or document-global text lookup. */
  layout = (): void => {
    this.revision++;
    this.tryFocus();
  };

  private async focusTargets(id: string, generation: number): Promise<boolean> {
    // Snapshot before awaiting: registration cleanup must not mutate this iteration.
    const candidates = Array.from(this.targets.get(id) ?? []);
    for (const target of candidates) {
      let abandoned = false;
      const isCurrent = () =>
        !abandoned && generation === this.generation && this.targets.get(id)?.has(target) === true;
      if (!isCurrent()) return false;
      try {
        // Native measurement may never call back after its view unmounts.
        // Navigation/unregistration releases the pending attempt immediately.
        let cancel: (() => void) | null = null;
        const canceled = new Promise<boolean>((resolve) => {
          cancel = () => {
            abandoned = true;
            resolve(false);
          };
        });
        this.cancelFocus = cancel;
        try {
          if (await Promise.race([target.focus(isCurrent), canceled])) return isCurrent();
        } finally {
          if (this.cancelFocus === cancel) this.cancelFocus = null;
        }
      } catch {
        // A native ref can disappear while measurement is queued. The current
        // request remains pending for the replacement's mount/layout event.
      }
    }
    return false;
  }

  private reveal(id: string): void {
    const reveal = this.revealers.get(id);
    if (reveal && !this.revealAttempted.has(reveal)) {
      this.revealAttempted.add(reveal);
      reveal();
    }
  }

  private tryFocus(): void {
    if (this.running || this.completed || !this.requested) return;
    const id = this.requested;
    if (!this.targets.get(id)?.size) {
      this.reveal(id);
      return;
    }
    const generation = this.generation;
    const revision = this.revision;
    this.running = true;
    Promise.resolve()
      .then(() => this.focusTargets(id, generation))
      .then((focused) => {
        if (generation === this.generation) {
          if (focused) this.completed = true;
          else this.reveal(id);
        }
        return focused;
      })
      .finally(() => {
        this.running = false;
        if (generation !== this.generation || revision !== this.revision) this.tryFocus();
      });
  }
}
