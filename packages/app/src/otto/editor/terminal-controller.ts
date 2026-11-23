import {
  openTerminalEditor,
  closeTerminalEditor,
  findTerminalEditor,
  type TerminalEditorSession,
} from "@getpaseo/plugin/otto/editor";
import type { EditorRpc } from "./client";
import type { EditorPreferences } from "./preferences";
import type { z } from "zod";

interface State {
  session: TerminalEditorSession | null;
  pending: boolean;
  exited: boolean;
  error: string | null;
}
export class FileTerminalController {
  private state: State = { session: null, pending: false, exited: false, error: null };
  private readonly listeners = new Set<() => void>();
  private opening: Promise<void> | null = null;
  private stopping: Promise<boolean> | null = null;
  private rpc: EditorRpc | null = null;
  private attempted = false;
  private uncertain = false;
  get hasUncertainLaunch() {
    return this.uncertain;
  }
  constructor(
    private readonly scope: { hostId: string; workspaceId: string; file: string },
    private readonly preferences: EditorPreferences,
    private readonly line: number | null,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private publish(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  connect(rpc: EditorRpc | null) {
    this.rpc = rpc;
  }
  open(explicit = false) {
    if (this.opening) return this.opening;
    if (!this.rpc || this.state.session || this.state.exited) return Promise.resolve();
    const rpc = this.rpc;
    const mode = this.preferences.fileEditorMode;
    if (mode === "off") return Promise.resolve();
    this.publish({ pending: true, error: null });
    const mayStart = explicit || !this.attempted;
    this.attempted = true;
    this.opening = this.start(rpc, mode, mayStart).finally(() => {
      this.opening = null;
      this.publish({ pending: false });
    });
    return this.opening;
  }
  private async start(rpc: EditorRpc, mode: "vim" | "neovim" | "custom", mayStart: boolean) {
    try {
      const existing = await rpc.call(findTerminalEditor, this.scope);
      if (!existing && !mayStart) {
        this.publish({
          error:
            "The previous editor is no longer running. Retry to open a new session from the saved file.",
        });
        return;
      }
      const session =
        existing ??
        (await this.create(rpc, {
          ...this.scope,
          mode,
          customCommand: this.preferences.fileEditorCustomCommand,
          line: this.line,
        }));
      this.uncertain = false;
      this.publish({ session });
    } catch (error) {
      this.publish({
        error: error instanceof Error ? error.message : "The terminal editor could not be opened.",
      });
    }
  }
  private create(rpc: EditorRpc, input: z.input<typeof openTerminalEditor.input>) {
    this.uncertain = true;
    return rpc.call(openTerminalEditor, openTerminalEditor.input.parse(input));
  }
  exited = () => {
    this.uncertain = false;
    this.publish({ session: null, exited: true });
  };
  stop(confirm: () => Promise<boolean>) {
    if (this.stopping) return this.stopping;
    this.stopping = this.close(confirm).finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }
  private async close(confirm: () => Promise<boolean>) {
    const confirmed = Boolean(this.state.pending || this.state.session);
    if (confirmed && !(await confirm())) return false;
    await this.opening;
    const session = this.state.session ?? (await this.resolveUncertain());
    if (this.uncertain && !session) return false;
    if (!session) return true;
    if (!confirmed && !(await confirm())) return false;
    if (!this.rpc) {
      this.publish({ error: "Reconnect to the host before stopping this editor." });
      return false;
    }
    try {
      await this.rpc.call(closeTerminalEditor, { ...this.scope, terminalId: session.terminalId });
      this.exited();
      return true;
    } catch (error) {
      this.publish({
        error: error instanceof Error ? error.message : "The terminal editor could not be stopped.",
      });
      return false;
    }
  }
  private async resolveUncertain() {
    if (!this.uncertain) return null;
    if (!this.rpc) {
      this.publish({ error: "Reconnect to resolve the pending editor before closing this file." });
      return null;
    }
    try {
      const session = await this.rpc.call(findTerminalEditor, this.scope);
      this.uncertain = false;
      if (session) this.publish({ session });
      return session;
    } catch {
      this.publish({
        error: "The editor's host outcome is unknown. Reconnect before closing this file.",
      });
      return null;
    }
  }
}
