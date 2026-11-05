import {
  DEFAULT_VIM_MAPPINGS,
  VIM_ACTIONS,
  validVimMapping,
  type EditorPreferences,
  type VimAction,
} from "../preferences";

export type DeviceEditorDraft = EditorPreferences;
interface State {
  draft: DeviceEditorDraft;
  dirty: boolean;
  pending: boolean;
  error: string | null;
  generation: number;
}
/** Device preferences stay in the existing settings owner. This model owns only
 * one opened form, so background settings updates cannot replace a dirty draft. */
export class DeviceEditorForm {
  private listeners = new Set<() => void>();
  private state: State;
  private version = 0;
  private closed = false;
  private activation = 0;
  constructor(
    initial: DeviceEditorDraft,
    private readonly write: (patch: DeviceEditorDraft) => Promise<unknown>,
  ) {
    const {
      vimMappings,
      fileEditorMode,
      fileEditorCustomCommand,
      alwaysUseOttoEditorForMarkdown,
      rulerEnabled,
      rulerColumn,
    } = initial;
    this.state = {
      draft: {
        vimMappings,
        fileEditorMode,
        fileEditorCustomCommand,
        alwaysUseOttoEditorForMarkdown,
        rulerEnabled,
        rulerColumn,
      },
      dirty: false,
      pending: false,
      error: null,
      generation: 0,
    };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<State>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  edit(patch: Partial<DeviceEditorDraft>) {
    this.version++;
    this.publish({ draft: { ...this.state.draft, ...patch }, dirty: true, error: null });
  }
  mapping(action: VimAction, key: string) {
    this.edit({
      vimMappings: {
        leader: "Space",
        mappings: { ...this.state.draft.vimMappings.mappings, [action]: key },
      },
    });
  }
  resetMappings() {
    this.edit({ vimMappings: DEFAULT_VIM_MAPPINGS });
    this.publish({ generation: this.state.generation + 1 });
  }
  private validate(): string | null {
    const claimed = new Set<string>();
    for (const action of VIM_ACTIONS) {
      const key = this.state.draft.vimMappings.mappings[action];
      if (key === undefined) continue;
      if (!validVimMapping(key)) return "Vim mappings use one or two letters or numbers.";
      if (claimed.has(key)) return `Vim mapping ${key} is assigned more than once.`;
      claimed.add(key);
    }
    if (
      this.state.draft.fileEditorMode === "custom" &&
      !this.state.draft.fileEditorCustomCommand.trim()
    )
      return "Enter a custom editor command.";
    return null;
  }
  async save() {
    if (this.closed || this.state.pending || !this.state.dirty) return;
    const error = this.validate();
    if (error) {
      this.publish({ error });
      return;
    }
    const version = this.version;
    const activation = this.activation;
    const draft = this.state.draft;
    this.publish({ pending: true, error: null });
    try {
      await this.write(draft);
      if (activation !== this.activation) return;
      this.publish({ dirty: this.version !== version });
    } catch {
      if (activation !== this.activation) return;
      this.publish({ error: "Editor settings could not be saved. Your edits are retained." });
    } finally {
      if (activation === this.activation) this.publish({ pending: false });
    }
  }
  activate() {
    this.closed = false;
    this.activation++;
    return () => {
      this.closed = true;
      this.activation++;
    };
  }
}
