import { BlockList, isIP } from "node:net";
import type { BrowserToolsExecuteInput } from "../../browser-tools/broker.js";
import {
  browserToolsFailure,
  type BrowserToolsResponsePayload,
} from "../../browser-tools/errors.js";
export type BrowserOperation = (
  input: BrowserToolsExecuteInput,
) => Promise<BrowserToolsResponsePayload>;
export interface PreviewNavigationTarget {
  serverId: string;
  browserId: string | null;
}
const blocked = new BlockList();
blocked.addSubnet("169.254.0.0", 16, "ipv4");
blocked.addAddress("100.100.100.200", "ipv4");
blocked.addAddress("fd00:ec2::254", "ipv6");
function blockedAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}
/** One admission boundary for normal browser creates and Preview's broker creates. No browser stack. */
export class BrowserAdmissions {
  private readonly creates = new Map<string, Promise<unknown>>();
  constructor(
    private readonly ports: {
      previewTarget(input: BrowserToolsExecuteInput): Promise<PreviewNavigationTarget | null>;
      lookup(hostname: string): Promise<readonly { address: string }[]>;
    },
  ) {}
  execute(
    input: BrowserToolsExecuteInput,
    next: BrowserOperation,
  ): Promise<BrowserToolsResponsePayload> {
    if (input.command.command !== "new_tab") return this.admit(input, next);
    const key = input.workspaceId ?? "unbound";
    const pending = (this.creates.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.admit(input, next));
    this.creates.set(key, pending);
    void pending
      .finally(() => {
        if (this.creates.get(key) === pending) this.creates.delete(key);
      })
      .catch(() => {});
    return pending;
  }
  private denied(input: BrowserToolsExecuteInput, message: string) {
    return browserToolsFailure({
      requestId: input.requestId ?? "otto-browser-admission",
      code: "browser_denied",
      message,
    });
  }
  private async destinationAllowed(raw: string): Promise<boolean> {
    const url = new URL(raw);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password)
      return false;
    const host = url.hostname
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
      .toLowerCase();
    if (host === "metadata.google.internal" || host === "instance-data.ec2.internal") return false;
    if (isIP(host)) return !blockedAddress(host);
    const addresses = await this.ports.lookup(host);
    return addresses.length > 0 && !addresses.some((entry) => blockedAddress(entry.address));
  }
  private async admit(
    input: BrowserToolsExecuteInput,
    next: BrowserOperation,
  ): Promise<BrowserToolsResponsePayload> {
    const command = input.command;
    if (command.command !== "new_tab" && command.command !== "navigate") return next(input);
    try {
      if (command.args.url && !(await this.destinationAllowed(command.args.url)))
        return this.denied(
          input,
          "Browser automation cannot navigate to cloud metadata endpoints or credential-bearing URLs.",
        );
      const preview = await this.ports.previewTarget(input);
      if (preview && command.command === "navigate" && command.args.browserId !== preview.browserId)
        return this.denied(
          input,
          "This URL belongs to a Preview server. Use the designated browserId returned by preview_start.",
        );
      if (
        preview &&
        command.command === "new_tab" &&
        (input.ottoPreviewServerId !== preview.serverId || preview.browserId)
      )
        return this.denied(
          input,
          "This URL belongs to a Preview server. Call preview_start to reuse its designated tab instead of opening another.",
        );
      if (command.command === "new_tab" && input.agentId) {
        if (!input.workspaceId)
          return this.denied(input, "Browser creation requires this chat's workspace.");
        const listed = await next({ ...input, command: { command: "list_tabs", args: {} } });
        if (!listed.ok || listed.result.command !== "list_tabs")
          return this.denied(
            input,
            "Existing browser tabs could not be confirmed. No extra tab was requested.",
          );
        const count = listed.result.tabs.filter(
          (tab) => tab.workspaceId === input.workspaceId,
        ).length;
        if (count >= 12)
          return this.denied(
            input,
            "This workspace already has 12 browser and Preview tabs. Reuse or close an existing tab before creating another.",
          );
      }
      return await next(input);
    } catch {
      return this.denied(
        input,
        "The host could not validate this browser destination or tab ownership. No automatic retry was started.",
      );
    }
  }
}
