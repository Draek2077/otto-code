import type { ContextReport, ContextRefinementSet } from "@getpaseo/plugin/otto/context-management";
import type { ReviewModelSelection } from "@/otto/knowledge/review-model-picker";
import { buildReviewDiff, applyReviewHunks, type ReviewDiff } from "@/otto/knowledge/review-hunks";
import type { ContextEdgeEdit } from "./edge-edit";
import { contextCompactionInstruction } from "./compaction-presets";

export type ContextFileRole = "rewrite" | "reference" | "excluded";
export interface ContextCompactionOutcome {
  nodeId: string;
  label: string;
  status: "changed" | "unchanged" | "conflict" | "unavailable";
  revision: string | null;
  message: string;
}
interface ReviewDocument {
  file: ContextRefinementSet["documents"][number];
  working: string;
  diff: ReviewDiff | null;
  kept: ReadonlySet<string>;
}
export interface ContextCompactionPort {
  read(nodeIds: string[], references: string[]): Promise<ContextRefinementSet>;
  propose(input: {
    documents: { nodeId: string; expectedRevision: string; text: string }[];
    references: { nodeId: string; expectedRevision: string }[];
    instruction: string;
    selection?: { provider: string; model: string };
  }): Promise<{
    files: { nodeId: string; base: string; proposal: string }[];
    inputCharacters: number;
  }>;
  apply(input: {
    documents: { nodeId: string; expectedRevision: string; text: string }[];
    userApprovedGlobal: boolean;
  }): Promise<{ ok: true; files: ContextCompactionOutcome[] } | { ok: false; message: string }>;
}
export interface ContextCompactionState {
  documents: ReviewDocument[];
  references: ContextRefinementSet["references"];
  omittedReferences: number;
  roles: ReadonlyMap<string, ContextFileRole>;
  setChanged: boolean;
  instruction: string;
  instructionVersion: number;
  selection: ReviewModelSelection | null;
  busy: boolean;
  blocked: boolean;
  loaded: boolean;
  error: string;
  outcomes: ContextCompactionOutcome[];
  inputCharacters: number | null;
}
export function keptContextText(document: ReviewDocument): string {
  return document.diff ? applyReviewHunks(document.diff, document.kept) : document.working;
}
/** Review intent is local. No proposal or hunk decision writes a file or grants a fresh host revision. */
export class ContextCompactionModel {
  private state: ContextCompactionState;
  private readonly listeners = new Set<() => void>();
  private activation: object | null = null;
  readonly getSnapshot = () => this.state;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(
    readonly nodes: ContextReport["nodes"],
    selectedId: string,
    private readonly port: ContextCompactionPort,
  ) {
    const selected = nodes.find((node) => node.id === selectedId);
    if (!selected) throw new Error("Select a context source first.");
    this.state = {
      documents: [],
      references: [],
      omittedReferences: 0,
      roles: new Map(
        nodes.map((node) => [node.id, node.id === selectedId ? "rewrite" : "reference"]),
      ),
      setChanged: false,
      instruction: contextCompactionInstruction(selected.label),
      instructionVersion: 0,
      selection: null,
      busy: false,
      blocked: false,
      loaded: false,
      error: "",
      outcomes: [],
      inputCharacters: null,
    };
  }
  private publish(patch: Partial<ContextCompactionState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  activate() {
    const activation = {};
    this.activation = activation;
    if (!this.state.loaded && !this.state.busy) void this.load(async () => true);
    return () => {
      if (this.activation === activation) this.activation = null;
    };
  }
  selectModel(selection: ReviewModelSelection | null) {
    if (!this.state.busy) this.publish({ selection });
  }
  setInstruction(instruction: string) {
    if (!this.state.busy) this.publish({ instruction });
  }
  preset(instruction: string) {
    if (!this.state.busy)
      this.publish({ instruction, instructionVersion: this.state.instructionVersion + 1 });
  }
  setRole(id: string, role: ContextFileRole) {
    if (this.state.busy || !this.state.roles.has(id)) return;
    const roles = new Map(this.state.roles);
    roles.set(id, role);
    this.publish({ roles, setChanged: true });
  }
  hasDraft(): boolean {
    return this.state.documents.some(
      (item) => item.diff !== null || item.working !== item.file.text,
    );
  }
  changedFiles() {
    return this.state.documents
      .map((item) => ({
        nodeId: item.file.nodeId,
        expectedRevision: item.file.revision,
        text: keptContextText(item),
      }))
      .filter(
        (item) =>
          item.text !==
          this.state.documents.find((document) => document.file.nodeId === item.nodeId)!.file.text,
      );
  }
  async load(confirmDiscard: () => Promise<boolean>): Promise<boolean> {
    const activation = this.activation;
    if (!activation || this.state.busy) return false;
    this.publish({ busy: true, error: "" });
    try {
      if (this.hasDraft() && !(await confirmDiscard())) return false;
      if (this.activation !== activation) return false;
      const ids = [...this.state.roles].filter(([, role]) => role === "rewrite").map(([id]) => id);
      const references = [...this.state.roles]
        .filter(([, role]) => role === "reference")
        .map(([id]) => id);
      if (!ids.length || ids.length > 12)
        throw new Error("Choose one to twelve rewritable prose files.");
      if (references.length > 256)
        throw new Error("Choose at most 256 read-only reference candidates.");
      const value = await this.port.read(ids, references);
      if (this.activation !== activation) return false;
      this.publish({
        documents: value.documents.map((file) => ({
          file,
          working: file.text,
          diff: null,
          kept: new Set(),
        })),
        references: value.references,
        omittedReferences: value.omittedReferences,
        loaded: true,
        setChanged: false,
        blocked: false,
        outcomes: [],
        inputCharacters: null,
      });
      return true;
    } catch (error) {
      if (this.activation === activation)
        this.publish({
          error: error instanceof Error ? error.message : "The document set could not be read.",
        });
      return false;
    } finally {
      this.publish({ busy: false });
    }
  }
  async generate(): Promise<void> {
    const activation = this.activation;
    if (this.state.documents.some((item) => item.diff?.hunks.length)) return;
    if (
      !activation ||
      !this.state.loaded ||
      this.state.busy ||
      this.state.blocked ||
      this.state.setChanged ||
      !this.state.instruction.trim()
    )
      return;
    const documents = this.state.documents;
    this.publish({ busy: true, error: "" });
    try {
      const response = await this.port.propose({
        documents: documents.map((item) => ({
          nodeId: item.file.nodeId,
          expectedRevision: item.file.revision,
          text: item.working,
        })),
        references: this.state.references.map((item) => ({
          nodeId: item.nodeId,
          expectedRevision: item.revision,
        })),
        instruction: this.state.instruction,
        selection: this.state.selection
          ? { provider: this.state.selection.provider, model: this.state.selection.model }
          : undefined,
      });
      if (this.activation !== activation) return;
      const proposals = new Map(response.files.map((file) => [file.nodeId, file]));
      if (proposals.size !== documents.length || response.files.length !== documents.length)
        throw new Error("The proposal does not match the reviewed document set.");
      const reviewed = documents.map((item) => {
        const file = proposals.get(item.file.nodeId);
        if (!file || file.base !== item.working)
          throw new Error("The proposal's base differs from the reviewed working text.");
        return {
          file: item.file,
          working: item.working,
          diff: buildReviewDiff(item.working, file.proposal),
          kept: new Set<string>(),
        };
      });
      this.publish({ documents: reviewed, inputCharacters: response.inputCharacters });
    } catch (error) {
      if (this.activation === activation)
        this.publish({
          error:
            error instanceof Error
              ? error.message
              : "The host could not confirm a proposal. No files were changed.",
        });
    } finally {
      this.publish({ busy: false });
    }
  }
  toggle(nodeId: string, hunkId: string) {
    if (this.state.busy || this.state.blocked) return;
    const documents = this.state.documents.map((item) => {
      if (item.file.nodeId !== nodeId || !item.diff?.hunks.some((hunk) => hunk.id === hunkId))
        return item;
      const kept = new Set(item.kept);
      if (kept.has(hunkId)) kept.delete(hunkId);
      else kept.add(hunkId);
      return { file: item.file, working: item.working, diff: item.diff, kept };
    });
    this.publish({ documents });
  }
  reviewKeptResult() {
    if (this.state.busy || this.state.blocked || this.state.setChanged) return;
    this.publish({
      documents: this.state.documents.map((item) => ({
        file: item.file,
        working: keptContextText(item),
        diff: null,
        kept: new Set(),
      })),
    });
  }
  async apply(
    lane: ContextEdgeEdit,
    confirm: (globalFiles: string[]) => Promise<boolean>,
    changed: () => void,
  ): Promise<void> {
    const activation = this.activation,
      documents = this.changedFiles();
    if (
      !activation ||
      this.state.busy ||
      this.state.blocked ||
      this.state.setChanged ||
      !documents.length
    )
      return;
    const global = this.state.documents
      .filter(
        (item) =>
          item.file.scope === "host" && documents.some((file) => file.nodeId === item.file.nodeId),
      )
      .map((item) => item.file.label);
    this.publish({ busy: true, error: "" });
    let outcomes: ContextCompactionOutcome[] = [],
      sent = false,
      acknowledged = false;
    try {
      await lane.change(
        () => confirm(global),
        async () => {
          sent = true;
          const result = await this.port.apply({
            documents,
            userApprovedGlobal: global.length > 0,
          });
          if (!result.ok) return result;
          outcomes = result.files;
          return { ok: true };
        },
        () => {
          acknowledged = true;
          this.publish({ outcomes, blocked: true });
          changed();
        },
        () => this.activation === activation,
        "compaction",
      );
    } finally {
      this.publish({
        busy: false,
        blocked: this.state.blocked || sent,
        error:
          sent && !acknowledged
            ? "The document set may have changed. Reload and review it before another apply."
            : this.state.error,
      });
    }
  }
}
