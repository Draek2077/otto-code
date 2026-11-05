import { createHash, randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  openTerminalEditor,
  findTerminalEditor,
  closeTerminalEditor,
  EDITOR_TERMINAL_PREFIX,
  type TerminalEditorSession,
} from "@getpaseo/plugin/otto/editor";
import type { TerminalManager } from "../../../terminal/terminal-manager.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import { findExecutableWithoutProbing } from "../../../executable-resolution/executable-resolution.js";
import { pathKey } from "./lsp/uri.js";
import { editorLaunchArguments } from "./terminal-command.js";
import { EditorError } from "./errors.js";
import type { z } from "zod";

/** File-owned PTYs use Paseo's normal manager/stream. Runtime choices and cwd
 * are captured at launch; a settings edit never retargets an active buffer. */
export class TerminalEditorHost {
  private readonly sessions = new Map<string, TerminalEditorSession>();
  private readonly pending = new Map<string, Promise<TerminalEditorSession>>();
  private readonly admissions = new Map<string, Promise<TerminalEditorSession>>();
  private readonly aliases = new Map<string, string>();
  constructor(
    private readonly host: () => string,
    private readonly manager: () => TerminalManager,
    private readonly registry: () => WorkspaceRegistry | null,
  ) {}
  invoke(method: string, input: unknown): Promise<unknown> | undefined {
    if (method === openTerminalEditor.name) return this.open(openTerminalEditor.input.parse(input));
    if (method === findTerminalEditor.name) return this.find(findTerminalEditor.input.parse(input));
    if (method === closeTerminalEditor.name)
      return this.close(closeTerminalEditor.input.parse(input));
    return undefined;
  }
  private async scope(input: { hostId: string; workspaceId: string; file: string }) {
    if (input.hostId !== this.host())
      throw new EditorError("invalid", "Editor request belongs to another host.");
    const workspace = await this.registry()?.get(input.workspaceId);
    if (!workspace || workspace.archivedAt)
      throw new EditorError("closed", "The workspace is no longer active.");
    if (!path.isAbsolute(input.file))
      throw new EditorError("invalid", "The editor requires an absolute owning-host file path.");
    const file = await realpath(input.file);
    if (!(await stat(file)).isFile())
      throw new EditorError("invalid", "The selected path is not a file.");
    const key =
      EDITOR_TERMINAL_PREFIX +
      createHash("sha256")
        .update(JSON.stringify([input.workspaceId, pathKey(file)]))
        .digest("hex");
    return { key, file, workspace };
  }
  private current(key: string) {
    const value = this.sessions.get(key);
    if (value && this.manager().getTerminal(value.terminalId)?.getExitInfo() === null) return value;
    this.sessions.delete(key);
    return null;
  }
  private async find(input: { hostId: string; workspaceId: string; file: string }) {
    if (input.hostId !== this.host())
      throw new EditorError("invalid", "Editor request belongs to another host.");
    const admitted = this.admissions.get(this.requestKey(input));
    if (admitted) await admitted.catch(() => undefined);
    const alias = this.aliases.get(this.requestKey(input));
    if (alias) return this.current(alias);
    return this.current((await this.scope(input)).key);
  }
  private requestKey(input: { hostId: string; workspaceId: string; file: string }) {
    return JSON.stringify([input.hostId, input.workspaceId, pathKey(input.file)]);
  }
  private open(input: z.output<typeof openTerminalEditor.input>): Promise<TerminalEditorSession> {
    const key = this.requestKey(input);
    const existing = this.admissions.get(key);
    if (existing) return existing;
    if (this.admissions.size >= 32)
      return Promise.reject(
        new EditorError("unavailable", "Too many terminal editors are being opened."),
      );
    const admitted = this.openCanonical(input).finally(() => {
      if (this.admissions.get(key) === admitted) this.admissions.delete(key);
    });
    this.admissions.set(key, admitted);
    return admitted;
  }
  private async openCanonical(
    input: z.output<typeof openTerminalEditor.input>,
  ): Promise<TerminalEditorSession> {
    const { key, file, workspace } = await this.scope(input);
    if (this.aliases.size >= 256) {
      const oldest = this.aliases.keys().next().value;
      if (oldest) this.aliases.delete(oldest);
    }
    this.aliases.set(this.requestKey(input), key);
    const existing = this.current(key);
    if (existing) return existing;
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.sessions.size + this.pending.size >= 16)
      throw new EditorError(
        "unavailable",
        "Close an existing terminal editor before opening another.",
      );
    const start = this.start(input, key, file, workspace.cwd);
    this.pending.set(key, start);
    try {
      return await start;
    } finally {
      if (this.pending.get(key) === start) this.pending.delete(key);
    }
  }
  private async start(
    input: z.output<typeof openTerminalEditor.input>,
    key: string,
    file: string,
    cwd: string,
  ) {
    const launch = editorLaunchArguments(input.mode, input.customCommand, file, input.line);
    const command = await findExecutableWithoutProbing(launch.command, { cwd });
    if (!command)
      throw new EditorError(
        "unavailable",
        `${launch.command} is not installed on this host. Choose Otto or install the editor on the selected host.`,
      );
    // Revalidate after discovery: archiving while resolving must not launch a child.
    await this.scope(input);
    const terminal = await this.manager().createTerminal({
      id: EDITOR_TERMINAL_PREFIX + randomUUID(),
      workspaceId: input.workspaceId,
      cwd,
      name: input.mode === "custom" ? "File editor" : launch.command,
      command,
      args: launch.args,
    });
    try {
      const owner = await this.registry()?.get(input.workspaceId);
      if (!owner || owner.archivedAt)
        throw new EditorError("closed", "The workspace closed while the editor was starting.");
    } catch (error) {
      await this.manager().killTerminalAndWait(terminal.id);
      throw error;
    }
    const session: TerminalEditorSession = {
      terminalId: terminal.id,
      workspaceId: input.workspaceId,
      cwd,
      file,
      mode: input.mode,
    };
    this.sessions.set(key, session);
    const release = terminal.onExit(() => {
      this.sessions.delete(key);
      release();
    });
    if (terminal.getExitInfo() !== null) {
      release();
      this.sessions.delete(key);
      throw new EditorError("closed", "The editor exited before it could be attached.");
    }
    return session;
  }
  private async close(input: z.output<typeof closeTerminalEditor.input>) {
    if (input.hostId !== this.host())
      throw new EditorError("invalid", "Editor request belongs to another host.");
    // Closing must remain possible after an external deletion/rename. The
    // server-issued incarnation and workspace bind the operation, not a new
    // filesystem lookup or a path that might now point to another file.
    const entry = [...this.sessions].find(
      ([, session]) =>
        session.terminalId === input.terminalId && session.workspaceId === input.workspaceId,
    );
    if (!entry) return { closed: true };
    const [key, current] = entry;
    await this.manager().killTerminalAndWait(current.terminalId);
    this.sessions.delete(key);
    return { closed: true };
  }
}
