import type { BrowserAutomationTabInfo } from "@otto-code/protocol/browser-automation/rpc-schemas";
import { browserToolsFailure, type BrowserToolsResponsePayload } from "./errors.js";

export const MAX_CHAT_BROWSER_TABS = 12;

/** All AI creation paths, including preview_start, pass through this gate. */
export class ChatBrowserTabLimit {
  private readonly creators = new Map<
    string,
    { agentId: string; workspaceId: string; isPreview: boolean }
  >();
  private readonly pending = new Map<string, Promise<unknown>>();

  public annotate(tabs: BrowserAutomationTabInfo[]): BrowserAutomationTabInfo[] {
    return tabs.map((tab) => {
      const creator = this.creators.get(tab.browserId);
      return creator && (!tab.workspaceId || tab.workspaceId === creator.workspaceId)
        ? {
            ...tab,
            openedByAgentId: tab.openedByAgentId ?? creator.agentId,
            isPreview: tab.isPreview ?? creator.isPreview,
          }
        : tab;
    });
  }

  public async create(input: {
    agentId: string;
    workspaceId: string;
    requestId: string;
    isPreview: boolean;
    list: () => Promise<BrowserToolsResponsePayload>;
    open: () => Promise<BrowserToolsResponsePayload>;
  }): Promise<BrowserToolsResponsePayload> {
    const key = JSON.stringify([input.workspaceId, input.agentId]);
    const previous = this.pending.get(key);
    const operation = (async () => {
      await previous?.catch(() => undefined);
      // A successful, unfiltered workspace listing is the only evidence that
      // a slot has been freed. Never guess capacity after a disconnect/timeout.
      const listed = await input.list();
      if (!listed.ok) return { ...listed, requestId: input.requestId };
      if (listed.result.command !== "list_tabs") {
        return browserToolsFailure({
          requestId: input.requestId,
          code: "browser_unknown_error",
          message: "Cannot verify the chat's browser tab limit: unexpected tab listing.",
          retryable: true,
        });
      }
      const liveIds = new Set(listed.result.tabs.map((tab) => tab.browserId));
      for (const [browserId, creator] of this.creators) {
        if (creator.workspaceId === input.workspaceId && !liveIds.has(browserId))
          this.creators.delete(browserId);
      }
      const controlledRows = this.annotate(listed.result.tabs).filter(
        (tab) => tab.openedByAgentId === input.agentId,
      );
      // Two connected app windows can expose the same restored tab identity.
      const controlled = [...new Map(controlledRows.map((tab) => [tab.browserId, tab])).values()];
      if (controlled.length >= MAX_CHAT_BROWSER_TABS) {
        return browserToolsFailure({
          requestId: input.requestId,
          code: "browser_denied",
          message: `This chat already controls ${controlled.length} browser/preview tabs (limit ${MAX_CHAT_BROWSER_TABS} combined). Reuse an existing tab or close one before opening another. Existing browserIds: ${controlled.map((tab) => tab.browserId).join(", ")}.`,
          retryable: false,
        });
      }
      const opened = await input.open();
      if (opened.ok && opened.result.command === "new_tab") {
        this.creators.set(opened.result.browserId, {
          agentId: input.agentId,
          workspaceId: input.workspaceId,
          isPreview: input.isPreview,
        });
      }
      return opened;
    })();
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    }
  }
}
