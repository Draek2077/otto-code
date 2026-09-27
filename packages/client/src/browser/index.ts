import type { SessionOutboundMessage } from "@otto-code/protocol/messages";
import type {
  RemoteBrowserCommand,
  RemoteBrowserExecuteResponse,
} from "@otto-code/protocol/browser-remote/rpc-schemas";

type BrowserResponseType = Extract<SessionOutboundMessage["type"], `browser.${string}.response`>;
type BrowserRequestType<TResponse extends BrowserResponseType> =
  TResponse extends `${infer Name}.response` ? `${Name}.request` : never;
type BrowserPayload<TResponse extends BrowserResponseType> = Extract<
  SessionOutboundMessage,
  { type: TResponse }
>["payload"];

export interface BrowserRequestHost {
  request<TResponse extends BrowserResponseType>(params: {
    message: { type: BrowserRequestType<TResponse> } & Record<string, unknown>;
    timeout?: number;
  }): Promise<BrowserPayload<TResponse>>;
}

/** Browser history and hosted browser RPCs, kept beside the client they ride on. */
export class BrowserRequests {
  constructor(private readonly host: BrowserRequestHost) {}

  async searchHistory(workspaceId: string, query: string) {
    const result = await this.host.request<"browser.history.search.response">({
      message: { type: "browser.history.search.request", workspaceId, query },
    });
    if (result.error) throw new Error(result.error);
    return result.entries;
  }

  async recordHistory(workspaceId: string, url: string, title: string): Promise<void> {
    const result = await this.host.request<"browser.history.record.response">({
      message: { type: "browser.history.record.request", workspaceId, url, title },
    });
    if (result.error) throw new Error(result.error);
  }

  async clearHistory(projectId: string): Promise<void> {
    const result = await this.host.request<"browser.history.clear.response">({
      message: { type: "browser.history.clear.request", projectId },
    });
    if (result.error) throw new Error(result.error);
  }

  async executeRemote(
    workspaceId: string,
    command: RemoteBrowserCommand,
  ): Promise<RemoteBrowserExecuteResponse["payload"]> {
    const result = await this.host.request<"browser.remote.execute.response">({
      message: { type: "browser.remote.execute.request", workspaceId, command },
      // A cold start launches the host browser before the page loads.
      timeout: command.kind === "frame" ? 15_000 : 45_000,
    });
    if (!result.ok)
      throw new Error(result.error ?? "The host browser could not complete this action.");
    return result;
  }
}
