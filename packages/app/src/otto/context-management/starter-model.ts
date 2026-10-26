import type { ContextStarter, ContextStarterName } from "@getpaseo/plugin/otto/context-management";
import type { ReviewModelSelection } from "@/otto/knowledge/review-model-picker";
import type { ContextEdgeEdit } from "./edge-edit";

interface StarterPort {
  read(fileName: ContextStarterName): Promise<ContextStarter>;
  propose(input: {
    fileName: ContextStarterName;
    expectedRevision: string;
    instruction: string;
    selection?: { provider: string; model: string };
  }): Promise<{ text: string }>;
  create(input: {
    fileName: ContextStarterName;
    expectedRevision: string;
    text: string;
  }): Promise<{ ok: true } | { ok: false; message: string }>;
}
interface Snapshot {
  fileName: ContextStarterName;
  origin: ContextStarter | null;
  text: string;
  instruction: string;
  selection: ReviewModelSelection | null;
  busy: boolean;
  error: string;
  version: number;
  created: boolean;
}
/** Local starter review only. No persistent draft, host revision or transport cache ownership. */
export class ContextStarterModel {
  private state: Snapshot = {
    fileName: "AGENTS.md",
    origin: null,
    text: "",
    instruction: "",
    selection: null,
    busy: false,
    error: "",
    version: 0,
    created: false,
  };
  private listeners = new Set<() => void>();
  private activation: object | null = null;
  private pending = false;
  constructor(private readonly port: StarterPort) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<Snapshot>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    const authority = {};
    this.activation = authority;
    return () => {
      if (this.activation === authority) this.activation = null;
    };
  }
  edit(text: string) {
    if (this.activation && !this.pending) this.publish({ text });
  }
  setInstruction(instruction: string) {
    if (this.activation && !this.pending) this.publish({ instruction });
  }
  selectModel(selection: ReviewModelSelection | null) {
    if (this.activation && !this.pending) this.publish({ selection });
  }
  private begin() {
    if (!this.activation || this.pending) return null;
    this.pending = true;
    this.publish({ busy: true, error: "" });
    return this.activation;
  }
  private finish() {
    this.pending = false;
    this.publish({ busy: false });
  }
  async load(fileName: ContextStarterName, confirm: () => Promise<boolean>): Promise<void> {
    const authority = this.begin();
    if (!authority) return;
    try {
      if (this.state.text && !(await confirm())) return;
      if (this.activation !== authority) return;
      const origin = await this.port.read(fileName);
      if (this.activation === authority)
        this.publish({
          origin,
          fileName,
          text: "",
          created: false,
          version: this.state.version + 1,
        });
    } catch {
      if (this.activation === authority)
        this.publish({
          error:
            "Project context could not be loaded. Existing drafts and files have been preserved.",
        });
    } finally {
      this.finish();
    }
  }
  async generate(confirm: () => Promise<boolean>): Promise<void> {
    const origin = this.state.origin;
    if (!origin) return;
    const authority = this.begin();
    if (!authority) return;
    try {
      if (this.state.text && !(await confirm())) return;
      if (this.activation !== authority) return;
      const result = await this.port.propose({
        fileName: origin.fileName,
        expectedRevision: origin.revision,
        instruction: this.state.instruction,
        ...(this.state.selection
          ? {
              selection: {
                provider: this.state.selection.provider,
                model: this.state.selection.model,
              },
            }
          : {}),
      });
      if (this.activation === authority)
        this.publish({ text: result.text, version: this.state.version + 1 });
    } catch {
      if (this.activation === authority)
        this.publish({
          error:
            "The starter proposal could not be generated. Your draft is kept. Check the provider or reload repository context before a new explicit attempt.",
        });
    } finally {
      this.finish();
    }
  }
  async save(writes: ContextEdgeEdit, confirm: () => Promise<boolean>, changed: () => void) {
    const authority = this.activation,
      origin = this.state.origin,
      text = this.state.text;
    if (!authority || this.pending || !origin || !text.trim()) return;
    this.pending = true;
    this.publish({ busy: true, error: "" });
    try {
      await writes.change(
        confirm,
        () =>
          this.port.create({ fileName: origin.fileName, expectedRevision: origin.revision, text }),
        () => {
          this.publish({ created: true });
          changed();
        },
        () => this.activation === authority,
      );
    } finally {
      this.finish();
    }
  }
}
