import { buildRefactorPrompt, type RefactorScope } from "./refactor-prompt";
/** One explicit local request draft. No provider, generation or write authority. */
export class EditorRefactorForm {
  private snapshot = { instruction: "", error: null as string | null };
  private readonly listeners = new Set<() => void>();
  private submitted = false;
  constructor(readonly scope: RefactorScope) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  edit = (instruction: string) => {
    this.snapshot = { instruction, error: null };
    for (const listener of this.listeners) listener();
  };
  submit(openDraft: (text: string) => void) {
    if (this.submitted || !this.snapshot.instruction.trim()) return false;
    const prompt = buildRefactorPrompt({
      scope: this.scope,
      instruction: this.snapshot.instruction,
    });
    try {
      openDraft(prompt);
      this.submitted = true;
      return true;
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        error: error instanceof Error ? error.message : "The request draft could not be opened.",
      };
      for (const listener of this.listeners) listener();
      return false;
    }
  }
}
