import type { InteractiveViewCommand } from "./view-bridge";
export interface ViewFrameMessage {
  id: number;
  command: InteractiveViewCommand;
}
export interface ViewFrameProps {
  html: string;
  channel: string;
  onMessage(raw: unknown): void;
  onTransport(send: ((message: ViewFrameMessage) => void) | null): void;
}
