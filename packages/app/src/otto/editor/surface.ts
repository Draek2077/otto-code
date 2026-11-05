import type { z } from "zod";
import { v4 as uuid } from "uuid";
import { sourceExcerpt } from "./context-attachment";
import type { RefactorScope } from "./refactor-prompt";
import {
  queryEditor,
  queryBoundEditor,
  observeEditor,
  releaseEditor,
  planEditorRename,
  applyEditorRename,
  undoEditorRename,
  type EditorDocument,
  type EditorObservation,
  type EditorQueryResult,
  type EditorPlan,
  type EditorEditOutcome,
  type EditorImage,
  writeEditorImage,
  searchEditorFiles,
  planEditorReplace,
  type EditorSearchOptions,
  type EditorSearchResult,
  EditorPosition,
  EditorLocation,
} from "@getpaseo/plugin/otto/editor";
import type { FileEditorModel } from "@/file-pane/editor/model";
import type { EditorRpc } from "./client";
import type { CodeCommand } from "./code/port";
import type { MarkdownEditorState } from "./markdown/contracts";
import type { EditorKeyAction } from "./shortcuts/contracts";
import { isMarkdownCommandName } from "./markdown/contracts";
import { EditorScrollLink } from "./scroll-link";

type Position = z.infer<typeof EditorPosition>;
export type CodeLocation = z.infer<typeof EditorLocation>;
export type EditorPanel =
  | "none"
  | "references"
  | "definitions"
  | "workspaceSymbols"
  | "outline"
  | "hover"
  | "diagnostics"
  | "rename";
interface Snapshot {
  split: boolean;
  activation: number;
  search: EditorSearchResult | null;
  searchOpen: boolean;
  editLabel: "Rename symbol" | "Replace in files";
  panel: EditorPanel;
  renameRequested: number;
  leader: string | null;
  selection: { characters: number; lines: number };
  markdown: MarkdownEditorState;
  busy: boolean;
  assetWrites: number;
  error: string | null;
  diagnosticMessage: string | null;
  result: EditorQueryResult | null;
  observation: EditorObservation | null;
  plan: EditorPlan | null;
  outcome: EditorEditOutcome | null;
}
export interface EditorSurfaceOptions {
  hostId: string;
  workspaceOwned?: boolean;
  workspaceId?: string;
  attach?(range: { start: Position; end: Position } | null): void;
  documentVisible?(): boolean;
  exportDocument?(text: string, extension: "html" | "pdf"): Promise<CodeLocation>;
  documentId: string;
  root: string;
  file: string;
  model: FileEditorModel;
  navigate(location: CodeLocation): void;
}

/** Local presentation/demand only. The Paseo model remains the only draft and
 * save owner; the host remains the language-server and rename-plan owner. */
export class EditorSurface {
  readonly scroll = new EditorScrollLink();
  setSplit(split: boolean) {
    this.scroll.setEnabled(split);
    this.publish({ split });
  }
  get file() {
    return this.options.file;
  }
  get contextScope() {
    return {
      hostId: this.options.hostId,
      root: this.options.root,
      workspaceId: this.options.workspaceId,
    };
  }
  get workspaceOwned() {
    return this.options.workspaceOwned !== false;
  }
  private selectedRange: { start: Position; end: Position } | null = null;
  refactorScope(): RefactorScope | null {
    if (!this.workspaceOwned) return null;
    const range = this.selectedRange;
    return {
      path: this.options.file,
      lineStart: range ? range.start.line + 1 : null,
      lineEnd: range ? range.end.line + 1 : null,
      selectedCode: range ? sourceExcerpt(this.options.model.getSnapshot().content, range) : null,
    };
  }
  addToChat(selection: boolean) {
    if (!this.workspaceOwned || !this.options.attach) return;
    this.options.attach(selection ? this.selectedRange : null);
  }
  async exportDocument(extension: "html" | "pdf") {
    if (
      !this.options.exportDocument ||
      this.snapshot.busy ||
      !(this.active || this.options.documentVisible?.())
    )
      return;
    const generation = this.generation;
    this.publish({ busy: true, error: null });
    try {
      const result = await this.options.exportDocument(
        this.options.model.getSnapshot().content,
        extension,
      );
      if (this.generation === generation && (this.active || this.options.documentVisible?.()))
        this.navigate(result);
      else
        this.publish({
          error: `The document was exported to ${result.file} while this tab was hidden.`,
        });
    } catch (error) {
      if (generation === this.generation) this.publish({ error: message(error) });
    } finally {
      if (generation === this.generation) this.publish({ busy: false });
    }
  }
  private snapshot: Snapshot = {
    split: false,
    activation: 0,
    search: null,
    searchOpen: false,
    editLabel: "Rename symbol",
    panel: "none",
    renameRequested: 0,
    leader: null,
    selection: { characters: 0, lines: 0 },
    markdown: { livePreview: true, targets: [] },
    busy: false,
    assetWrites: 0,
    error: null,
    diagnosticMessage: null,
    result: null,
    observation: null,
    plan: null,
    outcome: null,
  };
  private readonly listeners = new Set<() => void>();
  private readonly commands = new Set<(command: CodeCommand) => boolean>();
  command(command: CodeCommand) {
    if (this.active) for (const listener of this.commands) if (listener(command)) return true;
    return false;
  }
  onCommand = (listener: (command: CodeCommand) => boolean) => {
    this.commands.add(listener);
    return () => this.commands.delete(listener);
  };
  keyboard(action: EditorKeyAction) {
    if (!this.active) return false;
    if (isMarkdownCommandName(action) || action === "find" || action === "goToLine")
      return this.command(action);
    else if (action === "save") void this.options.model.save();
    else if (action === "renameSymbol") this.requestRename();
    else if (action === "goToDefinition") void this.run("definition");
    else if (action === "findReferences") void this.run("references");
    else void this.run("symbols");
    return true;
  }
  private client: EditorRpc | null = null;
  private position: Position = { line: 0, character: 0 };
  private text: string;
  private modified: boolean;
  private draftVersion = 0;
  private mirroredVersion: number | null = null;
  private generation = 0;
  private active = false;
  private writePending = false;
  private assetWrites = 0;
  get activation() {
    return this.generation;
  }
  private syncing = false;
  private observingGeneration: number | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  constructor(private readonly options: EditorSurfaceOptions) {
    this.text = options.model.getSnapshot().content;
    this.modified = options.model.getSnapshot().modified;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<Snapshot>) {
    if (
      Object.entries(patch).every(([key, value]) =>
        Object.is(Reflect.get(this.snapshot, key), value),
      )
    )
      return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  setPosition(position: Position) {
    this.position = position;
  }
  setSelection(characters: number, lines: number, range?: { start: Position; end: Position }) {
    this.selectedRange = characters > 0 && range ? range : null;
    if (
      this.snapshot.selection.characters !== characters ||
      this.snapshot.selection.lines !== lines
    )
      this.publish({ selection: { characters, lines } });
  }
  leaderPending(sequence: string | null) {
    this.publish({ leader: sequence });
  }
  setMarkdownTargets(targets: string[]) {
    if (targets !== this.snapshot.markdown.targets)
      this.publish({ markdown: { ...this.snapshot.markdown, targets } });
  }
  toggleMarkdownLivePreview() {
    this.publish({
      markdown: { ...this.snapshot.markdown, livePreview: !this.snapshot.markdown.livePreview },
    });
  }
  reportError(error: string) {
    this.publish({ error });
  }
  async writeImage(image: EditorImage): Promise<string | null> {
    const client = this.client,
      generation = this.generation;
    if (!client || !this.active) throw new Error("Connect the host to paste an image.");
    const document = this.document(client);
    this.assetWrites++;
    this.publish({ assetWrites: this.assetWrites, error: null });
    try {
      const result = await client.call(writeEditorImage, {
        hostId: client.hostId,
        root: document.root,
        file: document.file,
        operationId: uuid(),
        image,
      });
      if (!this.current(generation)) {
        this.publish({
          error: `An image was saved at ${result.path} while this editor was hidden. Its link was not inserted.`,
        });
        return null;
      }
      return result.insert;
    } catch (error) {
      if (!this.current(generation)) {
        this.publish({
          error:
            "An image write did not return before this editor was hidden. Check the host's assets directory before pasting it again.",
        });
        return null;
      }
      throw error;
    } finally {
      this.assetWrites--;
      this.publish({ assetWrites: this.assetWrites });
    }
  }
  navigate(location: CodeLocation) {
    this.options.navigate(location);
  }
  activate(client: EditorRpc | null) {
    this.client = client;
    this.active = true;
    this.generation++;
    this.publish({ activation: this.generation });
    this.mirroredVersion = null;
    const documentId = this.documentId();
    this.unsubscribe = this.options.model.subscribe(() => this.changed());
    this.changed();
    this.schedule();
    return () => {
      this.active = false;
      this.generation++;
      this.unsubscribe?.();
      this.unsubscribe = null;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.publish({ busy: false, leader: null, activation: this.generation, panel: "none" });
      if (this.writePending)
        this.publish({
          plan: null,
          outcome: null,
          error:
            "A rename was still running when the editor was hidden. Check the files before planning another change.",
        });
      if (client)
        void client
          .call(releaseEditor, { hostId: client.hostId, documentId })
          .catch(() => undefined);
    };
  }
  private changed() {
    const { content: text, modified } = this.options.model.getSnapshot();
    if (text === this.text && modified === this.modified) return;
    this.modified = modified;
    if (text === this.text) {
      this.schedule();
      return;
    }
    this.text = text;
    this.draftVersion++;
    this.publish({ observation: null, plan: null });
    this.schedule();
  }
  private schedule() {
    if (!this.active || !this.client) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, 250);
  }
  private document(client: EditorRpc): EditorDocument {
    return {
      hostId: client.hostId,
      root: this.options.root,
      file: this.options.file,
      documentId: this.documentId(),
      text: this.text,
      draftVersion: this.draftVersion,
      modified: this.options.model.getSnapshot().modified,
    };
  }
  private documentId() {
    return `${this.options.documentId}:${this.generation}`;
  }
  private async sync() {
    const client = this.client;
    if (!client || !this.active) return;
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = true;
    const generation = this.generation;
    const version = this.draftVersion;
    try {
      const result = await client.call(queryEditor, {
        ...this.document(client),
        action: "diagnostics",
        position: this.position,
      });
      if (!this.current(generation) || version !== this.draftVersion) return;
      this.mirroredVersion = version;
      if (result.state !== "ready")
        this.publish({ diagnosticMessage: result.message, observation: null });
      else {
        this.publish({ diagnosticMessage: null });
        void this.observe(client, generation, this.documentId());
      }
    } catch (error) {
      if (this.current(generation))
        this.publish({ diagnosticMessage: message(error), observation: null });
    } finally {
      this.syncing = false;
      if (this.again || version !== this.draftVersion) {
        this.again = false;
        this.schedule();
      }
    }
  }
  private async observe(client: EditorRpc, generation: number, documentId: string) {
    if (this.observingGeneration === generation) return;
    this.observingGeneration = generation;
    let cursor: string | null = null;
    try {
      while (this.current(generation)) {
        const observation: EditorObservation = await client.call(observeEditor, {
          hostId: client.hostId,
          documentId,
          cursor,
        });
        if (!this.current(generation)) return;
        cursor = observation.cursor;
        if (observation.draftVersion === this.draftVersion) this.publish({ observation });
      }
    } catch (error) {
      if (this.current(generation)) this.publish({ diagnosticMessage: message(error) });
    } finally {
      if (this.observingGeneration === generation) this.observingGeneration = null;
    }
  }
  private current(generation: number) {
    return this.active && generation === this.generation;
  }
  async request(
    action: EditorQueryResult["action"],
    position = this.position,
    query?: string,
  ): Promise<EditorQueryResult | null> {
    const client = this.client;
    if (!client || !this.active) return null;
    const generation = this.generation;
    const document = this.document(client);
    try {
      const result = await this.queryCurrent(client, document, action, position, query, generation);
      if (!this.current(generation) || document.draftVersion !== this.draftVersion) return null;
      return result;
    } catch (error) {
      if (this.current(generation)) {
        if (action === "hover" || action === "completion")
          this.publish({ diagnosticMessage: message(error) });
        else this.publish({ error: message(error) });
      }
      return null;
    }
  }
  private async queryCurrent(
    client: EditorRpc,
    document: EditorDocument,
    action: EditorQueryResult["action"],
    position: Position,
    query: string | undefined,
    generation: number,
  ): Promise<EditorQueryResult | null> {
    if (this.mirroredVersion === document.draftVersion) {
      const reply = await client.call(queryBoundEditor, {
        hostId: client.hostId,
        documentId: document.documentId,
        draftVersion: document.draftVersion,
        modified: document.modified,
        action,
        position,
        query,
      });
      if (reply.state === "ready") return reply.result;
      if (!this.current(generation) || document.draftVersion !== this.draftVersion) return null;
    }
    const result = await client.call(queryEditor, { ...document, action, position, query });
    if (this.current(generation) && document.draftVersion === this.draftVersion)
      this.mirroredVersion = document.draftVersion;
    return result;
  }
  async run(
    action: "definition" | "references" | "symbols" | "diagnostics" | "workspaceSymbols" | "hover",
    query?: string,
  ) {
    if (this.snapshot.busy) return;
    if (action === "diagnostics") {
      this.publish({ panel: "diagnostics" });
      return;
    }
    const generation = this.generation;
    this.publish({ busy: true, error: null });
    try {
      const result = await this.request(action, this.position, query);
      if (!this.current(generation) || !result) return;
      if (result.state !== "ready") {
        this.publish({ error: result.message });
        return;
      }
      if (action === "definition" && result.locations.length === 1)
        this.navigate(result.locations[0]);
      else this.publish({ result, panel: panelFor(action) });
    } catch (error) {
      if (this.current(generation)) this.publish({ error: message(error) });
    } finally {
      if (this.current(generation)) this.publish({ busy: false });
    }
  }
  requestRename() {
    this.publish({ renameRequested: this.snapshot.renameRequested + 1 });
  }
  closePanel() {
    this.publish({ panel: "none" });
  }
  openRenameReview() {
    this.publish({ panel: "rename" });
  }
  toggleSearch() {
    this.publish({ searchOpen: !this.snapshot.searchOpen });
  }
  async searchFiles(options: EditorSearchOptions) {
    const client = this.client,
      generation = this.generation;
    if (!client || !this.active || this.snapshot.busy) return;
    this.publish({ busy: true, error: null });
    try {
      const search = await client.call(searchEditorFiles, {
        hostId: client.hostId,
        root: this.options.root,
        options,
      });
      if (this.current(generation)) this.publish({ search });
    } catch (error) {
      if (this.current(generation)) this.publish({ error: message(error) });
    } finally {
      if (this.current(generation)) this.publish({ busy: false });
    }
  }
  async planReplace(replacement: string, files: string[]) {
    const client = this.client,
      search = this.snapshot.search,
      generation = this.generation;
    if (!client || !search || !this.active || this.snapshot.busy) return;
    this.publish({ busy: true, error: null });
    try {
      const plan = await client.call(planEditorReplace, {
        hostId: client.hostId,
        searchId: search.searchId,
        replacement,
        files,
      });
      if (this.current(generation))
        this.publish({ plan, outcome: null, panel: "rename", editLabel: "Replace in files" });
    } catch (error) {
      if (this.current(generation)) this.publish({ error: message(error) });
    } finally {
      if (this.current(generation)) this.publish({ busy: false });
    }
  }
  clearError() {
    this.publish({ error: null });
  }
  async planRename(newName: string) {
    const client = this.client;
    if (!client || !this.active || this.snapshot.busy || this.writePending) return;
    const generation = this.generation;
    this.publish({ busy: true, error: null });
    try {
      await this.options.model.save();
      const saved = this.options.model.getSnapshot();
      if (saved.modified || saved.status !== "clean")
        throw new Error("Resolve the file's save conflict before renaming.");
      if (!this.current(generation)) return;
      const plan = await client.call(planEditorRename, {
        ...this.document(client),
        position: this.position,
        newName,
      });
      if (this.current(generation))
        this.publish({ plan, outcome: null, panel: "rename", editLabel: "Rename symbol" });
    } catch (error) {
      if (this.current(generation)) this.publish({ error: message(error) });
    } finally {
      if (this.current(generation)) this.publish({ busy: false });
    }
  }
  async applyRename() {
    const plan = this.snapshot.plan;
    const client = this.client;
    if (!plan || !client || this.snapshot.busy || !this.active) return;
    await this.write(() =>
      client.call(applyEditorRename, { hostId: client.hostId, planId: plan.planId }),
    );
  }
  async undoRename() {
    const outcome = this.snapshot.outcome;
    const client = this.client;
    if (!outcome || !client || this.snapshot.busy || !this.active) return;
    await this.write(() =>
      client.call(undoEditorRename, { hostId: client.hostId, runId: outcome.runId }),
    );
  }
  private async write(operation: () => Promise<EditorEditOutcome>) {
    if (this.writePending) return;
    this.writePending = true;
    const generation = this.generation;
    this.publish({ busy: true, error: null });
    try {
      const outcome = await operation();
      if (!this.current(generation)) return;
      this.publish({ outcome, plan: null });
      // Disk observations already flow through Paseo's conflict-aware model.
      // Never force a reload over an edit made while the host was writing.
      await this.request("diagnostics");
    } catch (error) {
      if (this.current(generation)) this.publish({ error: message(error) });
    } finally {
      this.writePending = false;
      if (this.current(generation)) this.publish({ busy: false });
    }
  }
}
function panelFor(
  action: "definition" | "references" | "symbols" | "workspaceSymbols" | "hover",
): EditorPanel {
  if (action === "hover") return "hover";
  if (action === "workspaceSymbols") return "workspaceSymbols";
  if (action === "definition") return "definitions";
  return action === "symbols" ? "outline" : "references";
}
function message(error: unknown) {
  return error instanceof Error ? error.message : "The editor action could not be completed.";
}
