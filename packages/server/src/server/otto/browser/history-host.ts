import { z } from "zod";
import {
  clearBrowserHistory,
  recordBrowserHistory,
  searchBrowserHistory,
} from "@getpaseo/plugin/otto/browser-history";
import { BrowserHistoryStore } from "./history-store.js";

export class BrowserHistoryHost {
  private readonly store: BrowserHistoryStore;
  constructor(
    private readonly ports: {
      home: string;
      hostId: string;
      workspaces: {
        get(id: string): Promise<{ projectId: string; archivedAt: string | null } | null>;
      };
    },
  ) {
    this.store = new BrowserHistoryStore(ports.home);
  }
  private async project(input: { hostId: string; workspaceId: string }): Promise<string> {
    if (input.hostId !== this.ports.hostId) throw new Error("Wrong browser history host.");
    const workspace = await this.ports.workspaces.get(input.workspaceId);
    if (!workspace || workspace.archivedAt)
      throw new Error("Browser history requires an active workspace.");
    return workspace.projectId;
  }
  invoke(method: string, value: unknown): Promise<unknown> | undefined {
    switch (method) {
      case searchBrowserHistory.name:
        return this.guard(async () => {
          const input = searchBrowserHistory.input.parse(value);
          return this.store.search(await this.project(input), input.query);
        });
      case recordBrowserHistory.name:
        return this.guard(async () => {
          const input = recordBrowserHistory.input.parse(value);
          await this.store.record(await this.project(input), input.url, input.title);
          return { recorded: true as const };
        });
      case clearBrowserHistory.name:
        return this.guard(async () => {
          const input = clearBrowserHistory.input.parse(value);
          await this.store.clear(await this.project(input));
          return { cleared: true as const };
        });
    }
  }
  private async guard<T>(operation: () => Promise<T>) {
    try {
      return { ok: true as const, value: await operation() };
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code: error instanceof z.ZodError ? ("invalid" as const) : ("unavailable" as const),
          message:
            "Browser history is unavailable for this workspace. Its saved data has been preserved.",
        },
      };
    }
  }
}
