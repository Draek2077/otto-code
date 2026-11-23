import type { BrowserPaintFrame } from "@getpaseo/protocol/otto/browser-frames";
import type { HostBrowserInput } from "@getpaseo/plugin/otto/host-browser";
export interface HostFrameProps {
  frame: BrowserPaintFrame;
  displayed(sequence: number): void;
  failed(sequence: number): void;
  input(event: HostBrowserInput): void;
  focus(): void;
}
