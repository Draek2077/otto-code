import type { VisualizerTransport } from "./transport";
export interface VisualizerFrameProps {
  html: string;
  channel: string;
  interactive: boolean;
  onMessage(input: unknown): void;
  onTransport(transport: VisualizerTransport | null): void;
  onFailure(message: string): void;
}
