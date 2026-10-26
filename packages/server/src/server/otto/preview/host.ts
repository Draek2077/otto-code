import { resolve as resolvePath } from "node:path";
import { z } from "zod";
import {
  readPreviewConfig,
  startPreviewServer,
  stopPreviewServer,
  openPreviewBrowser,
  readPreviewLogs,
  type PreviewScope,
  type PreviewServer,
} from "@getpaseo/plugin/otto/preview";
import type { BrowserToolsBroker } from "../../browser-tools/broker.js";
import { PreviewManager } from "./manager.js";
import {
  previewDestination,
  previewCommandRevision,
  readPreviewLaunchConfig,
  PreviewConfigError,
  type PreviewLaunchConfig,
} from "./launch-config.js";

/** Internal authority, resolved from a registry workspace or a live owning agent; never wire input. */
export interface PreviewBinding {
  cwd: string;
  workspaceId: string;
  agentId?: string;
}
export class PreviewHost {
  private readonly browserBindings = new Map<string, string>();
  private readonly openings = new Map<string, Promise<string>>();
  constructor(
    private readonly ports: {
      hostId: string;
      manager: PreviewManager;
      workspaces: { get(id: string): Promise<{ cwd: string; archivedAt: string | null } | null> };
      broker: Pick<BrowserToolsBroker, "execute">;
    },
  ) {}
  async workspace(scope: PreviewScope): Promise<PreviewBinding> {
    if (scope.hostId !== this.ports.hostId)
      throw new Error("Select the workspace's owning Preview host.");
    const workspace = await this.ports.workspaces.get(scope.workspaceId);
    if (!workspace || workspace.archivedAt)
      throw new Error("Preview requires an active workspace.");
    return { cwd: resolvePath(workspace.cwd), workspaceId: scope.workspaceId };
  }
  private key(binding: PreviewBinding, id: string): string {
    return JSON.stringify([binding.cwd, binding.workspaceId, id]);
  }
  private project(binding: PreviewBinding, server: PreviewServer): PreviewServer {
    return { ...server, browserId: this.browserBindings.get(this.key(binding, server.id)) ?? null };
  }
  async list(binding: PreviewBinding) {
    let config: PreviewLaunchConfig | null = null,
      configError: string | null = null;
    try {
      config = await readPreviewLaunchConfig(binding.cwd);
    } catch (error) {
      configError =
        error instanceof Error
          ? error.message.slice(0, 4000)
          : "Preview configuration could not be read.";
    }
    const commands = (config?.servers ?? []).map((entry) => ({
      name: entry.name,
      port: entry.port,
      url: previewDestination(entry),
      command: [entry.runtimeExecutable, ...(entry.runtimeArgs ?? [])]
        .map((part) => JSON.stringify(part))
        .join(" "),
      commandRevision: previewCommandRevision(config!.cwd, entry),
    }));
    return {
      configured: config !== null,
      configError,
      revision: config?.revision ?? null,
      cwd: binding.cwd,
      commands,
      servers: (await this.ports.manager.list(binding.cwd, config)).map((server) =>
        this.project(binding, server),
      ),
    };
  }
  async start(binding: PreviewBinding, name: string, commandRevision: string) {
    const result = await this.ports.manager.start({
      cwd: binding.cwd,
      name,
      approvedCommandRevision: commandRevision,
    });
    let browserError: string | null = null;
    try {
      await this.open(binding, result.server.id);
    } catch {
      browserError =
        "The server is tracked, but its browser could not open. Check browser availability and choose Open browser to retry.";
    }
    return { server: this.project(binding, result.server), reused: result.reused, browserError };
  }
  async stop(binding: PreviewBinding, id: string): Promise<PreviewServer> {
    return this.project(binding, await this.ports.manager.stop(binding.cwd, id));
  }
  logs(binding: PreviewBinding, id: string, options: Parameters<PreviewManager["logs"]>[2]) {
    return this.ports.manager.logs(binding.cwd, id, options);
  }
  open(binding: PreviewBinding, id: string): Promise<string> {
    const key = this.key(binding, id);
    const pending = this.openings.get(key);
    if (pending) return pending;
    const opening = this.openBound(binding, id, key);
    this.openings.set(key, opening);
    void opening
      .finally(() => {
        if (this.openings.get(key) === opening) this.openings.delete(key);
      })
      .catch(() => {});
    return opening;
  }
  private async openBound(binding: PreviewBinding, id: string, key: string): Promise<string> {
    const server = (await this.ports.manager.list(binding.cwd, null)).find(
      (candidate) => candidate.id === id,
    );
    if (!server) throw new Error("Preview server does not belong to this workspace directory.");
    const listed = await this.ports.broker.execute({
      ...binding,
      command: { command: "list_tabs", args: {} },
    });
    if (!listed.ok || listed.result.command !== "list_tabs")
      throw new Error(
        "Could not confirm the existing Preview browser. No extra tab was requested.",
      );
    const boundId = this.browserBindings.get(key);
    if (
      boundId &&
      listed.result.tabs.some(
        (tab) => tab.browserId === boundId && tab.workspaceId === binding.workspaceId,
      )
    )
      return boundId;
    if (!boundId && this.browserBindings.size + this.openings.size > 4096)
      throw new Error(
        "Preview's browser association limit is reached. No extra tab was requested.",
      );
    const opened = await this.ports.broker.execute({
      ...binding,
      command: { command: "new_tab", args: { url: server.url } },
    });
    if (
      !opened.ok ||
      opened.result.command !== "new_tab" ||
      opened.result.workspaceId !== binding.workspaceId
    )
      throw new Error("Preview could not open a browser on its owning workspace.");
    this.browserBindings.delete(key);
    this.browserBindings.set(key, opened.result.browserId);
    return opened.result.browserId;
  }
  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    switch (method) {
      case readPreviewConfig.name:
        return this.guard(async () =>
          this.list(await this.workspace(readPreviewConfig.input.parse(value))),
        );
      case startPreviewServer.name:
        return this.guard(async () => {
          const input = startPreviewServer.input.parse(value);
          return this.start(await this.workspace(input), input.name, input.commandRevision);
        });
      case stopPreviewServer.name:
        return this.guard(async () => {
          const input = stopPreviewServer.input.parse(value);
          return this.stop(await this.workspace(input), input.serverId);
        });
      case openPreviewBrowser.name:
        return this.guard(async () => {
          const input = openPreviewBrowser.input.parse(value);
          return { browserId: await this.open(await this.workspace(input), input.serverId) };
        });
      case readPreviewLogs.name:
        return this.guard(async () => {
          const input = readPreviewLogs.input.parse(value);
          return this.logs(await this.workspace(input), input.serverId, input);
        });
    }
  }
  private async guard<T>(operation: () => Promise<T>) {
    try {
      const value = await operation();
      if (Buffer.byteLength(JSON.stringify(value), "utf8") > 768 * 1024)
        throw new Error(
          "Preview's response exceeds the transport budget. Reduce the launch configuration or inspect one tracked server's output directly.",
        );
      return { ok: true as const, value };
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code:
            error instanceof z.ZodError || error instanceof PreviewConfigError
              ? ("invalid" as const)
              : ("unavailable" as const),
          message:
            error instanceof Error
              ? error.message.slice(0, 4000)
              : "Preview is unavailable on this host.",
        },
      };
    }
  }
}
