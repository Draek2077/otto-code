import { decodeBrowserFrame } from "@otto-code/protocol/binary-frames/browser-frame";
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

type RemotePayload = RemoteBrowserExecuteResponse["payload"];

/** A frame response with its picture, however the host chose to send it. */
export type RemoteBrowserResult = Omit<RemotePayload, "frame" | "binaryFrame"> & {
  frame?: NonNullable<RemotePayload["binaryFrame"]> & {
    dataBase64?: string;
    image?: Uint8Array;
  };
};

// Pictures whose description has not arrived yet. One is normal; the bound
// covers a response that was lost after its picture was delivered.
const MAX_WAITING_IMAGES = 4;

export interface BrowserRequestHost {
  request<TResponse extends BrowserResponseType>(params: {
    requestId?: string;
    message: { type: BrowserRequestType<TResponse> } & Record<string, unknown>;
    timeout?: number;
  }): Promise<BrowserPayload<TResponse>>;
}

/** Browser history and hosted browser RPCs, kept beside the client they ride on. */
export class BrowserRequests {
  private readonly images = new Map<string, Uint8Array>();
  private sequence = 0;

  constructor(private readonly host: BrowserRequestHost) {}

  /** Takes a hosted browser picture off the socket. False for any other frame. */
  handleBinaryFrame(bytes: Uint8Array): boolean {
    const frame = decodeBrowserFrame(bytes);
    if (!frame) return false;
    this.images.set(frame.requestId, frame.image);
    while (this.images.size > MAX_WAITING_IMAGES)
      this.images.delete(this.images.keys().next().value!);
    return true;
  }

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
  ): Promise<RemoteBrowserResult> {
    const requestId = `browser-${Date.now().toString(36)}-${++this.sequence}`;
    const result = await this.host.request<"browser.remote.execute.response">({
      requestId,
      message: {
        type: "browser.remote.execute.request",
        workspaceId,
        command: command.kind === "frame" ? { ...command, binary: true } : command,
      },
      // A cold start launches the host browser before the page loads.
      timeout: command.kind === "frame" ? 15_000 : 45_000,
    });
    const image = this.images.get(requestId);
    this.images.delete(requestId);
    if (!result.ok)
      throw new Error(result.error ?? "The host browser could not complete this action.");
    const { frame, binaryFrame, ...rest } = result;
    if (frame) return { ...rest, frame };
    if (binaryFrame && image) return { ...rest, frame: { ...binaryFrame, image } };
    return rest;
  }
}
