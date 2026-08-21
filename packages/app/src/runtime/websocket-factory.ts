import { nativeWebSocketFactory } from "@otto-code/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@otto-code/client/internal/daemon-client-transport-types";

export function createAppWebSocketFactory(): WebSocketFactory {
  return nativeWebSocketFactory;
}
