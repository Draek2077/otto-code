import { randomUUID } from "node:crypto";
import {
  BROWSER_AUTOMATION_COMMAND_NAMES,
  type BrowserAutomationCommand,
  type BrowserAutomationExecuteRequest,
  type BrowserAutomationResult,
  type BrowserAutomationDialogEvent,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import {
  readHostBrowserTabs,
  executeHostBrowser,
  watchHostBrowser,
  ackHostBrowser,
  detachHostBrowser,
  inputHostBrowser,
  type HostBrowserInput,
  type HostBrowserTab,
} from "@getpaseo/plugin/otto/host-browser";
import { BrowserToolsBroker } from "../../../browser-tools/broker.js";
import {
  browserToolsFailure,
  BrowserToolsRequestError,
  type BrowserToolsResponsePayload,
} from "../../../browser-tools/errors.js";
import { HostBrowserPages, type HostTab } from "./pages.js";
import { HostBrowserViews, type HostBrowserSource, type HostCapturePage } from "./views.js";
export const OTTO_BROWSER_HOST_ID = "otto-host-browser";
/** The same broker owns native and hosted tab affinity; this is one registered host, not another tool stack. */
export class HostBrowserService<P extends HostCapturePage> {
  private readonly views: HostBrowserViews<P>;
  private unregister: (() => void) | null = null;
  constructor(
    private readonly ports: {
      hostId: string;
      broker: BrowserToolsBroker;
      pages: HostBrowserPages<P>;
      workspaces: { get(id: string): Promise<{ cwd: string; archivedAt: string | null } | null> };
      execute(
        tab: HostTab,
        page: P,
        command: BrowserAutomationCommand,
      ): Promise<BrowserAutomationResult>;
      input(page: P, event: HostBrowserInput, ticket: string): Promise<void>;
      clear(browserId: string): void;
      dialogs(page: P): BrowserAutomationDialogEvent[];
    },
  ) {
    this.views = new HostBrowserViews(ports.pages, async (workspaceId) => {
      await this.binding(workspaceId);
    });
  }
  register() {
    if (this.unregister) throw new Error("Host Browser is already registered.");
    this.unregister = this.ports.broker.registerClient({
      id: OTTO_BROWSER_HOST_ID,
      hostKind: "Otto Host Browser",
      defaultTimeoutMs: 45_000,
      supportedCommands: BROWSER_AUTOMATION_COMMAND_NAMES,
      sendBrowserAutomationRequest: async (request) => {
        const payload = await this.request(request);
        this.ports.broker.receiveResponse(
          { type: "browser.automation.execute.response", payload },
          [OTTO_BROWSER_HOST_ID],
        );
      },
    });
  }
  private async binding(workspaceId: string, cwd?: string) {
    const workspace = await this.ports.workspaces.get(workspaceId);
    if (!workspace || workspace.archivedAt)
      throw new Error("Host Browser requires an active workspace.");
    return { workspaceId, cwd: cwd ?? workspace.cwd };
  }
  private project(tab: HostTab): HostBrowserTab {
    const { cwd: _cwd, ...publicTab } = tab;
    return publicTab;
  }
  private async request(
    request: BrowserAutomationExecuteRequest,
  ): Promise<BrowserToolsResponsePayload> {
    const dialogs: BrowserAutomationDialogEvent[] = [];
    try {
      if (!request.workspaceId) throw new Error("Host Browser requires the caller's workspace.");
      const binding = await this.binding(request.workspaceId, request.cwd),
        command = request.command;
      const result = await this.command(binding, command, (page) =>
        dialogs.push(...this.ports.dialogs(page).slice(-10)),
      );
      return {
        requestId: request.requestId,
        ok: true,
        result,
        ...(dialogs.length ? { dialogs } : {}),
      };
    } catch (error) {
      const failure = browserToolsFailure({
        requestId: request.requestId,
        code: error instanceof BrowserToolsRequestError ? error.code : "browser_unknown_error",
        message:
          error instanceof BrowserToolsRequestError
            ? error.message
            : "Host Browser could not complete this action. Check its runtime and workspace, then make a new explicit attempt.",
      });
      return dialogs.length ? { ...failure, dialogs } : failure;
    }
  }
  private async command(
    binding: { workspaceId: string; cwd: string },
    command: BrowserAutomationCommand,
    captureDialogs: (page: P) => void,
  ): Promise<BrowserAutomationResult> {
    const { pages } = this.ports;
    if (command.command === "list_tabs")
      return {
        command: command.command,
        tabs: pages.list(binding.workspaceId).map((tab) => ({
          browserId: tab.browserId,
          workspaceId: tab.workspaceId,
          url: tab.url,
          title: tab.title,
          isActive: false,
          isLoading: tab.isLoading,
          canGoBack: tab.canGoBack,
          canGoForward: tab.canGoForward,
        })),
      };
    if (command.command === "new_tab") {
      const url = command.args.url ?? "about:blank";
      if (url.length > 8192) throw new Error("The browser URL exceeds its transport budget.");
      const tab = await pages.create(binding, url);
      await pages.use(binding.workspaceId, tab.browserId, async (page) => {
        captureDialogs(page);
      });
      return {
        command: command.command,
        browserId: tab.browserId,
        workspaceId: tab.workspaceId,
        url: tab.url,
      };
    }
    const browserId = command.args.browserId;
    const tab = pages.get(binding.workspaceId, browserId);
    if (command.command === "close_tab") {
      await pages.remove(binding.workspaceId, browserId);
      this.ports.clear(browserId);
      return { command: command.command, browserId };
    }
    return pages.use(binding.workspaceId, browserId, async (page) => {
      try {
        return await this.ports.execute({ ...tab, cwd: binding.cwd }, page, command);
      } finally {
        captureDialogs(page);
      }
    });
  }
  invoke(method: string, value: unknown, source?: HostBrowserSource): Promise<unknown> | undefined {
    switch (method) {
      case readHostBrowserTabs.name:
        return this.guard(async () => {
          const input = readHostBrowserTabs.input.parse(value);
          await this.scope(input);
          return this.ports.pages.list(input.workspaceId).map((tab) => this.project(tab));
        });
      case executeHostBrowser.name:
        return this.executeApp(value);
      case watchHostBrowser.name:
        return this.guard(async () => {
          const input = watchHostBrowser.input.parse(value);
          if (input.hostId !== this.ports.hostId)
            throw new Error("Host Browser belongs to another host.");
          await this.views.watch(input, this.source(source));
          return this.project(this.ports.pages.get(input.workspaceId, input.browserId));
        });
      case ackHostBrowser.name:
        return this.guard(async () => {
          const input = ackHostBrowser.input.parse(value);
          await this.scope(input);
          return this.views.acknowledge(
            input.ticket,
            input.sequence,
            this.source(source),
            input.workspaceId,
          );
        });
      case detachHostBrowser.name:
        return this.guard(async () => {
          const input = detachHostBrowser.input.parse(value);
          // Releasing an owned viewer remains legal after workspace archival/removal.
          if (input.hostId !== this.ports.hostId)
            throw new Error("Host Browser belongs to another host.");
          await this.views.detach(input.ticket, this.source(source), input.workspaceId);
          return true as const;
        });
      case inputHostBrowser.name:
        return this.guard(async () => {
          const input = inputHostBrowser.input.parse(value);
          await this.scope(input);
          await this.views.input(
            input.ticket,
            this.source(source),
            (page) => this.ports.input(page, input.event, input.ticket),
            input.workspaceId,
          );
          return true as const;
        });
    }
  }
  private source(source: HostBrowserSource | undefined) {
    if (!source) throw new Error("Host Browser needs an authenticated owned-source connection.");
    return source;
  }
  private async scope(scope: { hostId: string; workspaceId: string }) {
    if (scope.hostId !== this.ports.hostId)
      throw new Error("Host Browser belongs to another host.");
    return this.binding(scope.workspaceId);
  }
  private async executeApp(value: unknown): Promise<BrowserToolsResponsePayload> {
    const requestId = `host-browser-${randomUUID()}`;
    try {
      const input = executeHostBrowser.input.parse(value),
        binding = await this.scope(input);
      if (input.command.command !== "list_tabs" && input.command.command !== "new_tab")
        this.ports.pages.get(binding.workspaceId, input.command.args.browserId);
      return await this.ports.broker.execute({
        ...binding,
        requestId,
        command: input.command,
        ottoBrowserHostId: OTTO_BROWSER_HOST_ID,
      });
    } catch {
      return browserToolsFailure({
        requestId,
        code: "browser_denied",
        message: "This Host Browser action is unavailable for this host and workspace.",
      });
    }
  }
  private async guard<T>(operation: () => Promise<T>) {
    try {
      const value = await operation();
      if (Buffer.byteLength(JSON.stringify(value), "utf8") > 768 * 1024)
        throw new Error("Host Browser response exceeds its transport budget.");
      return { ok: true as const, value };
    } catch {
      return {
        ok: false as const,
        error:
          "Host Browser could not acknowledge this request. Check the selected host, workspace and connection before trying again.",
      };
    }
  }
  async close() {
    this.unregister?.();
    this.unregister = null;
    const errors: unknown[] = [];
    try {
      await this.views.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await this.ports.pages.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length)
      throw new AggregateError(errors, "Host Browser cleanup did not finish.", {
        cause: errors[0],
      });
  }
}
