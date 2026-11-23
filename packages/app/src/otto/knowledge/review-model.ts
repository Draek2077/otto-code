import type {
  KnowledgeReviewDirective,
  KnowledgeRefinementTarget,
  KnowledgeGenerationSelection,
} from "@getpaseo/plugin/otto/project-knowledge";
import { applyReviewHunks, buildReviewDiff, type ReviewDiff } from "./review-hunks";

export interface ReviewSelection {
  start: number;
  end: number;
  selectedText: string;
}
export interface ReviewPort {
  // Errors constructed by the owning adapter already contain sanitized host copy.
  propose(input: {
    workingBody: string;
    directives: KnowledgeReviewDirective[];
    selection?: KnowledgeGenerationSelection;
  }): Promise<{ base: string; proposal: string }>;
  apply(body: string, reason: string): Promise<void>;
}
export class KnowledgeReviewPortError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface ReviewState {
  selection: (KnowledgeGenerationSelection & { providerLabel: string; modelLabel: string }) | null;
  body: string;
  notes: KnowledgeReviewDirective[];
  diff: ReviewDiff | null;
  kept: ReadonlySet<string>;
  busy: boolean;
  blocked: boolean;
  error: string;
  applied: boolean;
  reason: string;
}
/** Only local review intent. The original article/revision never adopts peer refreshes. */
export class KnowledgeReviewModel {
  private state: ReviewState;
  private listeners = new Set<() => void>();
  private active = false;
  private authority = 0;
  private sequence = 0;
  constructor(
    readonly target: KnowledgeRefinementTarget,
    readonly base: string,
    private readonly port: ReviewPort,
  ) {
    this.state = {
      body: base,
      selection: null,
      notes: [],
      diff: null,
      kept: new Set(),
      busy: false,
      blocked: false,
      error: "",
      applied: false,
      reason: "",
    };
  }
  getSnapshot = () => this.state;
  selectModel(selection: ReviewState["selection"]) {
    if (!this.state.busy) this.publish({ selection });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<ReviewState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    this.active = true;
    return () => {
      this.active = false;
      this.authority++;
    };
  }
  peerRevision(revision: string) {
    if (revision !== this.target.revision)
      this.publish({
        blocked: true,
        error:
          "This article changed. Discard this review and reopen the saved article before applying changes.",
      });
  }
  note(
    selection: ReviewSelection,
    kind: KnowledgeReviewDirective["kind"],
    value: string,
    id?: string,
  ) {
    if (this.state.busy || this.state.blocked) return false;
    const body = this.state.body;
    if (
      selection.start < 0 ||
      selection.end <= selection.start ||
      selection.end > body.length ||
      body.slice(selection.start, selection.end) !== selection.selectedText
    ) {
      this.publish({ error: "Select an exact article passage again before adding this note." });
      return false;
    }
    const others = this.state.notes.filter((item) => item.id !== id);
    if (
      others.length >= 32 ||
      others.some((item) => item.start < selection.end && selection.start < item.end)
    ) {
      this.publish({
        error: "Review notes cannot overlap. Edit or remove the existing note first.",
      });
      return false;
    }
    this.publish({
      notes: [...others, { ...selection, id: id ?? `note-${++this.sequence}`, kind, value }],
      error: "",
    });
    return true;
  }
  remove(id: string) {
    if (!this.state.busy)
      this.publish({ notes: this.state.notes.filter((item) => item.id !== id) });
  }
  reason(value: string) {
    if (!this.state.busy) this.publish({ reason: value });
  }
  toggle(id: string) {
    if (this.state.busy || !this.state.diff?.hunks.some((item) => item.id === id)) return;
    const kept = new Set(this.state.kept);
    if (!kept.delete(id)) kept.add(id);
    this.publish({ kept });
  }
  reviewAcceptedResult() {
    if (this.state.busy || !this.state.diff) return;
    this.publish({
      body: applyReviewHunks(this.state.diff, this.state.kept),
      diff: null,
      notes: [],
      error: "",
    });
  }
  async generate() {
    if (!this.active || this.state.busy || this.state.blocked || !this.state.notes.length)
      return false;
    const authority = this.authority;
    const workingBody = this.state.body;
    const directives = this.state.notes.map((item) => ({ ...item }));
    this.publish({ busy: true, error: "" });
    try {
      const selected = this.state.selection;
      const result = await this.port.propose({
        workingBody,
        directives,
        ...(selected ? { selection: { provider: selected.provider, model: selected.model } } : {}),
      });
      if (!this.active || authority !== this.authority) return false;
      if (result.base !== this.base) {
        this.publish({
          blocked: true,
          error: "The saved article changed. Discard this review and reopen it.",
        });
        return false;
      }
      const diff = buildReviewDiff(this.base, result.proposal);
      this.publish({ diff, kept: new Set(diff.hunks.map((item) => item.id)) });
      return true;
    } catch (error) {
      if (this.active && authority === this.authority)
        this.publish({
          blocked:
            this.state.blocked ||
            (error instanceof KnowledgeReviewPortError && error.code === "conflict"),
          error:
            error instanceof KnowledgeReviewPortError
              ? error.message
              : "A proposal could not be generated. Your notes are retained; nothing was written.",
        });
      return false;
    } finally {
      this.publish({ busy: false });
    }
  }
  async apply(confirm: () => Promise<boolean>) {
    if (!this.active || this.state.busy || this.state.blocked || !this.state.diff) return false;
    const body = applyReviewHunks(this.state.diff, this.state.kept);
    if (body === this.base || !this.state.reason.trim()) {
      this.publish({ error: "Keep a change and add a reason before applying." });
      return false;
    }
    const authority = this.authority;
    this.publish({ busy: true, error: "" });
    let submitted = false;
    try {
      if (!(await confirm()) || !this.active || authority !== this.authority) return false;
      submitted = true;
      await this.port.apply(body, this.state.reason.trim());
      if (!this.active || authority !== this.authority) {
        this.publish({
          blocked: true,
          error: "The write outcome must be checked by reopening the saved article.",
        });
        return false;
      }
      this.publish({ applied: true });
      return true;
    } catch {
      this.publish({
        blocked: this.state.blocked || submitted,
        error:
          "The changes could not be acknowledged. Keep this proposal and reopen the saved article before another write.",
      });
      return false;
    } finally {
      this.publish({ busy: false });
    }
  }
}
